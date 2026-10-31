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
  const ds = [document, ...[...document.querySelectorAll("iframe")].map(f => { try { return f.contentDocument } catch (e) { return null } })].filter(d => d && d.querySelector);
  const sliderDoc = ds.find(d => d.querySelector("canvas.block") || ((d.body?.innerText || "").includes("向右滑动")));
  if (sliderDoc) return "slider";
  const loadingDoc = ds.find(d => (d.body?.innerText || "").includes("正在加载"));
  if (loadingDoc) return "loading";
  const listDoc = ds.find(d => d.querySelector("input[type=text]") && (d.body?.innerText || "").length > 80 && !(d.body?.innerText || "").includes("请完成安全验证"));
  if (listDoc) return "ready";
  return (document.body?.innerText || "").length ? "noframe" : "shield";
})()`);
// 缺口检测:画布像素读在主帧隔离子世界(经 contentDocument 穿透,原生 Canvas API 无钩),窗口几何在主世界
const findGapIW = () => evIW(`(() => {
  const ifr = [...document.querySelectorAll("iframe")].find(f => { try { return f.contentDocument && f.contentDocument.querySelector("canvas.block") } catch (e) { return false } });
  if (!ifr) return null;
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
  const win = await ev(`(() => { const ifr2 = [...document.querySelectorAll("iframe")].find(f => { try { return f.contentDocument && f.contentDocument.querySelector("canvas.block") } catch (e) { return false } }); const r = ifr2.getBoundingClientRect(); return { fx: r.x, fy: r.y, sx: window.screenX, sy: window.screenY, oh: window.outerHeight, ih: window.innerHeight, dpr: window.devicePixelRatio }; })()`);
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
  const d = [...document.querySelectorAll("iframe")].map(f => { try { return f.contentDocument } catch (e) { return null } }).find(x => x && x.querySelector("canvas.block"));
  const b = d.querySelector("canvas.block");
  const g = [...d.querySelectorAll("canvas")].find(c => !c.classList.contains("block"));
  return b.getBoundingClientRect().x - g.getBoundingClientRect().x;
})()`);
async function xdragClosedLoop(sx, sy, targetCss, variant) {
  const wid = execSync('xdotool search --onlyvisible --name "." | head -1', XSH).trim();
  execSync('xdotool windowfocus ' + wid, XSH);
  await sleep(300);
  execSync('xdotool mousemove ' + sx + ' ' + sy, XSH);
  await sleep(300);
  execSync('xdotool mousedown 1', XSH);
  await sleep(200 + Math.floor(Math.random() * 150));
  // 轨迹风格轮换:验证对轨迹形态抽样,通过率有随机性,多风格+整页刷新重试最大化命中
  const styles = {
    coarse: { step: [10, 16], ms: [15, 40], yjit: 2 },
    fine: { step: [3, 5], ms: [20, 40], yjit: 0 },
    finejit: { step: [3, 5], ms: [20, 40], yjit: 1 },
    slow: { step: [2, 3], ms: [60, 100], yjit: 1 },
    mid: { step: [6, 9], ms: [25, 55], yjit: 2 },
    coarsefast: { step: [10, 16], ms: [8, 18], yjit: 2 },
    wave: { step: [4, 6], ms: [25, 45], yjit: 3 },
    burst: { step: [5, 12], ms: [12, 30], yjit: 1 },
  };
  const st = styles[variant] || styles.fine;
  let mouseAbs = sx;
  const est = (targetCss + 1.5 + Math.random() * 2) / 0.92;
  const over = 2 + Math.floor(Math.random() * 4);
  const span = st.step[1] - st.step[0];
  let moved = 0;
  let guard = 0;
  while (moved < est && guard++ < 200) {
    const step = st.step[0] + Math.floor(Math.random() * (span + 1));
    moved = Math.min(est + over, moved + step);
    const yj = st.yjit ? Math.floor(Math.random() * (2 * st.yjit + 1)) - st.yjit : 0;
    const x = Math.round(sx + moved + (Math.random() < 0.15 ? (Math.random() - 0.5) * 2 : 0));
    execSync('xdotool mousemove ' + x + ' ' + (sy + yj), XSH);
    await sleep(st.ms[0] + Math.floor(Math.random() * (st.ms[1] - st.ms[0] + 1)) + (Math.random() < 0.07 ? 40 + Math.floor(Math.random() * 60) : 0));
  }
  // 回拉对准
  mouseAbs = Math.round(sx + est);
  execSync('xdotool mousemove ' + mouseAbs + ' ' + sy, XSH);
  await sleep(150 + Math.floor(Math.random() * 150));
  // 闭环修正(最多3轮)。接受带偏好人类松差:亚像素精确对位(±0.1px)实测全被拒,
  // 带 2-4px 松差的落位实测通过,故瞄 target+2~4px,±1.2px 内即停
  const aim = targetCss + 1.5 + Math.random() * 2;
  for (let round = 0; round < 3; round++) {
    const off = await blockOff();
    log(`fix[${round}] off=` + (typeof off === "number" ? off.toFixed(1) : off) + " target=" + targetCss.toFixed(1) + " aim=" + aim.toFixed(1));
    if (typeof off !== "number" || off <= 0) break;
    const err = aim - off;
    if (Math.abs(err) <= 2) break;
    if (Math.abs(err) > 60) break;
    const fixAbs = mouseAbs + (err / 0.92) * 0.8;
    const n2 = Math.max(2, Math.round(Math.abs(fixAbs - mouseAbs) / 3) + 1);
    for (let i = 1; i <= n2; i++) {
      const x = Math.round(mouseAbs + (fixAbs - mouseAbs) * (i / n2));
      execSync('xdotool mousemove ' + x + ' ' + sy, XSH);
      await sleep(18 + Math.floor(Math.random() * 30));
    }
    mouseAbs = Math.round(fixAbs);
    await sleep(120);
  }
  await sleep(120 + Math.floor(Math.random() * 200));
  execSync('xdotool mouseup 1', XSH);
}

// --- main ---
await cdp("Page.enable");
await cdp("Page.navigate", { url: URL });
log("navigated, waiting shield challenge...");
let st = "shield";
for (let i = 0; i < 60; i++) {
  await sleep(2000);
  st = await readState();
  if (st === "slider" || st === "ready" || st === "loading") break;
}
if (st === "slider") await sleep(3000);
log("state: " + st);
if (st === "slider") {
  const VARIANTS = ["coarse", "fine", "finejit", "slow", "mid", "coarsefast", "wave", "burst"];
  const t0 = Date.now();
  for (let attempt = 1; attempt <= 10 && st === "slider" && Date.now() - t0 < 330000; attempt++) {
    if (attempt > 1) {
      // 失败后验证码进僵死态(再拖必冻),整页重载拿全新挑战;隔离世界随导航销毁须重建
      IW_CTX = null;
      await cdp("Page.navigate", { url: URL });
      st = "shield";
      for (let i = 0; i < 45; i++) {
        await sleep(2000);
        st = await readState();
        if (st === "slider" || st === "ready" || st === "loading") break;
      }
      await sleep(2000);
      if (st !== "slider") { log("after reload: " + st); break; }
    }
    let g = null;
    for (let i = 0; i < 12 && !g; i++) {
      const t = await findGap();
      if (t && t.variance > 100 && t.gap > 40) g = t;
      else {
        if (i === 3) {
          const d = await evIW(`(() => [...document.querySelectorAll("iframe")].map(f => { try { return (f.contentDocument ? f.contentDocument.querySelectorAll("canvas").length : -1) + "/" + (f.contentDocument?.body?.innerText || "").length } catch (e) { return "X" } }).join(",") + " self=" + document.querySelectorAll("canvas").length })()`).catch(e => "iw-err " + String(e).slice(0, 60));
          log("gap diag: " + d);
        }
        await sleep(2000);
      }
    }
    if (!g) { log("gap detect failed"); break; }
    // 滑块可能在折叠线下方:先滚到视口中心,再重读把手坐标
    await ev(`(() => { const ifr = [...document.querySelectorAll("iframe")].find(f => { try { return f.contentDocument && f.contentDocument.querySelector("canvas.block") } catch (e) { return false } }); ifr.scrollIntoView({ block: "center" }); ifr.contentDocument.querySelector(".slidercaptcha")?.scrollIntoView({ block: "center" }); return 1; })()`);
    await sleep(500);
    g = await findGap();
    if (!g) { log("gap lost after scroll"); break; }
    if (g.handleCssY > g.innerH - 20 || g.handleCssY < 0) { log(`handle still offscreen y=${Math.round(g.handleCssY)}`); break; }
    const chromeH = g.outerH - g.innerH;
    const sx = Math.round(g.screenX + g.handleCssX * g.dpr);
    const sy = Math.round(g.screenY + chromeH + g.handleCssY * g.dpr);
    const dist = Math.round(g.targetCss * g.dpr);
    log(`attempt ${attempt}[${VARIANTS[(attempt - 1) % VARIANTS.length]}]: gap=${g.gap} var=${g.variance} screen=(${sx},${sy}) dist=${dist}`);
    await xdragClosedLoop(sx, sy, g.targetCss, VARIANTS[(attempt - 1) % VARIANTS.length]);
    await sleep(4000);
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
log("slider solved; net probe:");
const netLog = [];
ws.addEventListener("message", (ev2) => { const m = JSON.parse(ev2.data); if (m.method === "Network.requestWillBeSent") netLog.push(m.params.request.method + " " + m.params.request.url.slice(0, 150) + " POST:" + (m.params.request.postData || "").slice(0, 150)); });
await cdp("Network.enable", {});
const ctrls = await ev(`(() => { const doc = [...document.querySelectorAll("iframe")].map(f => { try { return f.contentDocument } catch (e) { return null } }).find(x => x && x.querySelector && x.querySelector("input")); if (!doc) return "nodoc"; const list = [...doc.querySelectorAll("input,button,select,a")].map(el => el.tagName + ":" + (el.type||"") + ":" + (el.id||"") + ":" + (el.name||"") + ":" + ((el.innerText||el.value||"").trim().slice(0,12))).filter(x => !x.startsWith("A:")).slice(0, 20); const inp = [...doc.querySelectorAll("input")].find(i => i.type === "text"); if (inp) { inp.value = "AVC"; inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true })); } const btn = [...doc.querySelectorAll("button, a, input[type=button]")].find(b => ((b.innerText || b.value || "") + "").includes("搜索")); if (btn) btn.click(); return JSON.stringify(list); })()`);
log("ctrls " + String(ctrls).slice(0, 900));
await sleep(6000);
log("NET " + JSON.stringify(netLog.filter(x => !/\.(js|css|png|jpg|gif|woff)/.test(x)).slice(-12), null, 1));
const rows = await ev(`(() => { const doc = [...document.querySelectorAll("iframe")].map(f => { try { return f.contentDocument } catch (e) { return null } }).find(x => x && x.body); return [...doc.querySelectorAll("tr")].slice(0, 4).map(tr => (tr.innerText||"").replace(/\s+/g," ").slice(0, 100)); })()`);
log("rows " + JSON.stringify(rows));
process.exit(0);
for (const kw of KEYWORDS) {
  try {
    const clicked = await ev(`(() => {
      const doc = [...document.querySelectorAll("iframe")].map(f => { try { return f.contentDocument } catch (e) { return null } }).find(x => x && x.querySelector("input"));
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
