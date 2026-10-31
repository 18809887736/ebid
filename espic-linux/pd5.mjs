// espic patrol on Linux: CDP (read state/gap) + xdotool (real X input for slider).
// argv[2] = comma-separated keywords (from Windows config.yaml keywords.include)
import { execSync } from "node:child_process";

const KEYWORDS = (process.argv[2] || "AVC").split(",").map((s) => s.trim()).filter(Boolean);
const URL = "https://ebid.espic.com.cn/newgdtcms//category/bulletinListNew.html?dates=300&categoryId=2&tenderMethod=01&tabName=%E6%8B%9B%E6%A0%87%E4%BF%A1%E6%81%AF&page=1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- minimal CDP client ---
const targets = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
function cdp(method, params = {}) {
  return new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error("cdp timeout " + method)); } }, 30000);
  });
}
async function ev(js) {
  const r = await cdp("Runtime.evaluate", { expression: js, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails).slice(0, 200));
  return r.result.result.value;
}
function log(msg) { console.log(`[espic-linux] ${new Date().toISOString().slice(11, 23)} ${msg}`); }

// 隔离子世界:盾在主世界钩了 Canvas API(drawImage/getImageData 即触发反爬并废掉滑块输入),
// 隔离世界有独立 JS 上下文,原生画布读取对页面脚本不可见
let IW_CTX = null;
async function ensureIW() {
  if (IW_CTX !== null) return;
  // 验证码画布所在 iframe 实为 about:blank 被盾脚本填充,不在帧树子帧里;
  // 隔离世界建在主帧,经 contentDocument 穿透访问,其原生 Canvas API 未被主世界钩住
  const ft = (await cdp("Page.getFrameTree", {})).result.frameTree;
  const r = await cdp("Page.createIsolatedWorld", { frameId: ft.frame.id, grantUniveralAccess: true });
  IW_CTX = r.executionContextId;
}
async function evIW(js) {
  await ensureIW();
  const r = await cdp("Runtime.evaluate", { expression: js, returnByValue: true, contextId: IW_CTX });
  if (r.exceptionDetails) throw new Error("iw eval: " + JSON.stringify(r.exceptionDetails).slice(0, 200));
  return r.result.result.value;
}

// --- page helpers (run in main frame; iframe is same-origin) ---
const readState = () => ev(`(() => {
  const doc = document.querySelector("iframe")?.contentDocument;
  const t = doc?.body?.innerText || "";
  if (doc && (t.includes("向右滑动") || doc.querySelector(".slider"))) return "slider";
  if (t.includes("正在加载")) return "loading";
  if (doc && t.length > 80 && !t.includes("请完成安全验证")) return "ready";
  return (document.body?.innerText || "").length ? "noframe" : "shield";
})()`);
// 缺口检测:画布像素读在主帧隔离子世界(经 contentDocument 穿透,原生 Canvas API 无钩),窗口几何在主世界
const findGapIW = () => evIW(`(() => {
  const ifr = document.querySelector("iframe");
  const fr = ifr.getBoundingClientRect();
  const doc = ifr.contentDocument;
  const bg = [...doc.querySelectorAll("canvas")].find((c) => !c.classList.contains("block"));
  const block = doc.querySelector("canvas.block");
  const slider = doc.querySelector(".slider");
  if (!bg || !block || !slider) return null;
  const snap = (src) => {
    const cp = document.createElement("canvas");
    cp.width = src.width; cp.height = src.height;
    cp.getContext("2d").drawImage(src, 0, 0);
    return cp.getContext("2d").getImageData(0, 0, cp.width, cp.height);
  };
  const bi = snap(bg);
  const BW = bg.width, BH = bg.height, PW = block.width;
  let sum = 0, sum2 = 0, n = 0;
  for (let i = 0; i < bi.data.length; i += 400) { sum += bi.data[i]; sum2 += bi.data[i] * bi.data[i]; n++; }
  const variance = sum2 / n - (sum / n) * (sum / n);
  const lum = (x, y) => { const i = (y * BW + x) * 4; return 0.299*bi.data[i] + 0.587*bi.data[i+1] + 0.114*bi.data[i+2]; };
  const edge = [];
  for (let x = 2; x < BW - 2; x++) {
    let s = 0;
    for (let y = 45; y < 125; y += 2) s += Math.abs(lum(x + 2, y) - lum(x - 2, y));
    edge[x] = s;
  }
  const pairs = [];
  for (let x = 30; x <= BW - PW - 5; x++) {
    let left = 0, right = 0;
    for (let d = -4; d <= 4; d++) {
      left = Math.max(left, edge[x + d] || 0);
      right = Math.max(right, edge[x + PW + d] || 0);
    }
    pairs.push({ x, s: Math.round(Math.min(left, right)) });
  }
  pairs.sort((a, b) => b.s - a.s);
  const sr = slider.getBoundingClientRect();
  const bgr = bg.getBoundingClientRect();
  return {
    variance: Math.round(variance), gap: pairs[0].x,
    targetCss: pairs[0].x * (bgr.width / BW),
    hx: sr.x + sr.width / 2,
    hy: sr.y + sr.height / 2,
  };
})()`);
const findGap = async () => {
  const g = await findGapIW();
  if (!g) return null;
  const win = await ev(`(() => { const r = document.querySelector("iframe").getBoundingClientRect(); return { fx: r.x, fy: r.y, sx: window.screenX, sy: window.screenY, oh: window.outerHeight, ih: window.innerHeight, dpr: window.devicePixelRatio }; })()`);
  return {
    ...g,
    handleCssX: win.fx + g.hx,
    handleCssY: win.fy + g.hy,
    screenX: win.sx, screenY: win.sy,
    outerH: win.oh, innerH: win.ih, dpr: win.dpr,
  };
};

// --- xdotool human drag (XTest = trusted input at X server level) ---
// 无 WM 必须先 XSetInputFocus。注意:xdotool 调用保持与已验证版本逐字一致的风格
// (直接 execSync + 字符串拼接);经 sh 包装/模板串的等价改写实测会导致 mousedown 不咬合
const XSH = { shell: "/bin/bash", encoding: "utf8" };
const blockOff = () => ev(`(() => {
  const d = document.querySelector("iframe").contentDocument;
  const b = d.querySelector("canvas.block");
  const g = [...d.querySelectorAll("canvas")].find(c => !c.classList.contains("block"));
  return b.getBoundingClientRect().x - g.getBoundingClientRect().x;
})()`);
async function xdragClosedLoop(sx, sy, targetCss) {
  const wid = execSync('xdotool search --onlyvisible --name "." | head -1', XSH).trim();
  execSync('xdotool windowfocus ' + wid, XSH);
  await sleep(300);
  execSync('xdotool mousemove ' + sx + ' ' + sy, XSH);
  await sleep(300);
  execSync('xdotool mousedown 1', XSH);
  await sleep(250);
  // 分段移动+读块位闭环(比率实测约 0.92):粗调→修正→对准→松手(坐标全部为屏幕绝对值)
  let mouseAbs = sx;
  const stages = [0.5, 0.8, 1.0];
  for (const frac of stages) {
    const targetAbs = sx + Math.round(targetCss * frac / 0.92);
    const steps = Math.max(3, Math.min(8, Math.round(Math.abs(targetAbs - mouseAbs) / 5) + 2));
    for (let i = 1; i <= steps; i++) {
      const x = Math.round(mouseAbs + (targetAbs - mouseAbs) * (i / steps) + (Math.random() - 0.5) * 2);
      const y = sy + Math.floor(Math.random() * 5) - 2;
      execSync('xdotool mousemove ' + x + ' ' + y, XSH);
      await sleep(15 + Math.floor(Math.random() * 25));
    }
    mouseAbs = targetAbs;
    await sleep(150 + Math.floor(Math.random() * 200));
    const off = await blockOff();
    if (typeof off === "number" && off > 0) {
      const err = targetCss - off;
      if (Math.abs(err) > 1.5 && Math.abs(err) < 40) {
        const fixAbs = mouseAbs + Math.round(err / 0.92);
        const n2 = Math.max(2, Math.min(5, Math.round(Math.abs(fixAbs - mouseAbs) / 3) + 1));
        for (let i = 1; i <= n2; i++) {
          const x = Math.round(mouseAbs + (fixAbs - mouseAbs) * (i / n2));
          execSync('xdotool mousemove ' + x + ' ' + sy, XSH);
          await sleep(20 + Math.floor(Math.random() * 30));
        }
        mouseAbs = fixAbs;
        await sleep(150);
      }
    }
  }
  const off2 = await blockOff();
  if (typeof off2 === "number") {
    const err = targetCss - off2;
    if (Math.abs(err) > 0.6 && Math.abs(err) < 30) {
      execSync('xdotool mousemove ' + Math.round(mouseAbs + err / 0.92) + ' ' + sy, XSH);
      await sleep(200);
      const off3 = await blockOff();
      const e3 = targetCss - off3;
      if (Math.abs(e3) > 0.8 && Math.abs(e3) < 10) {
        mouseAbs = mouseAbs + Math.round(err / 0.92);
        execSync('xdotool mousemove ' + Math.round(mouseAbs + e3) + ' ' + sy, XSH);
        await sleep(250);
      }
    }
  }
  await sleep(150 + Math.floor(Math.random() * 200));
  execSync('xdotool mouseup 1', XSH);
}

// --- main ---
await cdp("Page.enable");
await cdp("Page.navigate", { url: URL });
log("navigated, waiting shield challenge...");
let st = "shield";
for (let i = 0; i < 40; i++) {
  await sleep(3000);
  st = await readState();
  if (st === "slider" || st === "ready" || st === "loading") break;
}
if (st === "slider") await sleep(3000);
log("state: " + st);
if (st === "slider") {
  for (let attempt = 1; attempt <= 8 && st === "slider"; attempt++) {
    let g = null;
    for (let i = 0; i < 10 && !g; i++) { const t = await findGap(); if (t && t.variance > 100 && t.gap > 40) g = t; else await sleep(3000); }
    if (!g) { log("gap detect failed"); break; }
    // 滑块可能在折叠线下方:先滚到视口中心,再重读把手坐标
    await ev(`(() => { const ifr = document.querySelector("iframe"); ifr.scrollIntoView({ block: "center" }); ifr.contentDocument.querySelector(".slidercaptcha")?.scrollIntoView({ block: "center" }); return 1; })()`);
    await sleep(500);
    g = await findGap();
    if (!g) { log("gap lost after scroll"); break; }
    if (g.handleCssY > g.innerH - 20 || g.handleCssY < 0) { log(`handle still offscreen y=${Math.round(g.handleCssY)}`); break; }
    const chromeH = g.outerH - g.innerH;
    const sx = Math.round(g.screenX + g.handleCssX * g.dpr);
    const sy = Math.round(g.screenY + chromeH + g.handleCssY * g.dpr);
    const dist = Math.round(g.targetCss * g.dpr);
    log(`attempt ${attempt}: gap=${g.gap} var=${g.variance} screen=(${sx},${sy}) dist=${dist}`);
    await xdragClosedLoop(sx, sy, g.targetCss);
    await sleep(6000);
    st = await readState();
    log("after drag: " + st);
    if (st === "loading") {
      for (let i = 0; i < 8 && st === "loading"; i++) { await sleep(5000); st = await readState(); }
      log("after loading: " + st);
    }
  }
}
if (st !== "ready") {
  log("SLIDER_FAILED final state: " + st);
  process.exit(1);
}
log("slider solved; dumping search controls:"); const dump = await ev(`(() => { const ifr = document.querySelector("iframe"); const doc = ifr.contentDocument; const inputs = [...doc.querySelectorAll("input, button, select, a.btn")].map(el => ({ tag: el.tagName, type: el.type || "", id: el.id || "", name: el.name || "", cls: (el.className||"").toString().slice(0,40), txt: (el.innerText||el.value||"").slice(0,20), ph: el.placeholder || "" })); const forms = [...doc.querySelectorAll("form")].map(f => ({ action: f.action.slice(0,100), method: f.method })); const rows = [...doc.querySelectorAll("tr")].slice(0,3).map(tr => (tr.innerText||"").replace(/\s+/g," ").slice(0,80)); return { inputs: inputs.slice(0,20), forms, rows, ifrSrc: ifr.src.slice(0,120) }; })()`); log("DUMP " + JSON.stringify(dump)); process.exit(0);
for (const kw of KEYWORDS) {
  try {
    const clicked = await ev(`(() => {
      const doc = document.querySelector("iframe")?.contentDocument;
      if (!doc) return false;
      const inp = [...doc.querySelectorAll("input")].find(i => i.type === "text" && i.offsetParent);
      if (!inp) return false;
      inp.value = ${JSON.stringify(kw)};
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      const btn = [...doc.querySelectorAll("button, a, input[type=button]")].find(b => ((b.innerText || b.value || "") + "").includes("搜索"));
      if (btn) { btn.click(); return true; }
      return false;
    })()`);
    if (!clicked) { log(`kw=${kw}: no search control`); continue; }
    await sleep(6000);
    const items = await ev(`(() => {
      const doc = document.querySelector("iframe")?.contentDocument;
      if (!doc) return [];
      const seen = new Set();
      return [...doc.querySelectorAll("tr, li, .list-item, .item")]
        .map(el => {
          const t = (el.innerText || "").replace(/\\s+/g, " ").trim();
          const d = (el.innerText || "").match(/\\d{4}-\\d{2}-\\d{2}/);
          return { title: t.slice(0, 200), date: d ? d[0] : "" };
        })
        .filter(r => {
          if (r.title.length < 12 || /^(招标编号|招标方式|报名截止|发布时间|采购项目信息)/.test(r.title)) return false;
          const k = r.title.slice(0, 40);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .slice(0, 10);
    })()`);
    log(`RESULT|espic|${kw}|${items.length}|${items.length ? items[0].title : ""}|${items.length ? items[0].date : ""}`);
  } catch (e) {
    log(`kw=${kw} error: ${e.message}`);
  }
}
log("done");
process.exit(0);
