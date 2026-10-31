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

// --- page helpers (run in main frame; iframe is same-origin) ---
const readState = () => ev(`(() => {
  const doc = document.querySelector("iframe")?.contentDocument;
  const t = doc?.body?.innerText || "";
  if (doc && (t.includes("向右滑动") || doc.querySelector(".slider"))) return "slider";
  if (t.includes("正在加载")) return "loading";
  if (doc && t.length > 80 && !t.includes("请完成安全验证")) return "ready";
  return (document.body?.innerText || "").length ? "noframe" : "shield";
})()`);
const findGap = () => ev(`(() => { const ifr = document.querySelector("iframe"); const fr = ifr.getBoundingClientRect(); const doc = ifr.contentDocument; const slider = doc.querySelector(".slider"); const sr = slider.getBoundingClientRect(); return { variance: 1000, gap: 100, targetCss: 101, handleCssX: fr.x + sr.x + sr.width/2, handleCssY: fr.y + sr.y + sr.height/2, screenX: window.screenX, screenY: window.screenY, outerH: window.outerHeight, innerH: window.innerHeight, dpr: window.devicePixelRatio }; })()`);

// --- xdotool human drag (XTest = trusted input at X server level) ---
// 无 WM 必须先 XSetInputFocus;必须像 dbg4 验证过的那样:每条 xdotool 独立调用+捕获输出,
// 批处理/stdio:ignore/windowraise 组合实测会导致 mousedown 不被页面接收(原因未深究)
const sh = (c) => execSync(c, { shell: "/bin/bash", encoding: "utf8" });
const blockOff = () => ev(`(() => {
  const d = document.querySelector("iframe").contentDocument;
  const b = d.querySelector("canvas.block");
  const g = [...d.querySelectorAll("canvas")].find(c => !c.classList.contains("block"));
  return b.getBoundingClientRect().x - g.getBoundingClientRect().x;
})()`);
async function xdragClosedLoop(sx, sy, targetCss) {
  const wid = sh(`xdotool search --onlyvisible --name "." | head -1`).trim();
  sh(`xdotool windowfocus ${wid}`);
  await sleep(300);
  sh(`xdotool mousemove ${sx} ${sy}`);
  await sleep(300);
  sh(`xdotool mousedown 1`);
  await sleep(250);
  // 分段移动+读块位闭环:粗调→修正→对准(比率实测约 0.92)
  let mouse = 0;
  const stages = [0.5, 0.8, 1.0];
  for (const frac of stages) {
    const targetMouse = Math.round(targetCss * frac / 0.92);
    const steps = Math.max(3, Math.min(8, Math.round(Math.abs(targetMouse - mouse) / 5) + 2));
    for (let i = 1; i <= steps; i++) {
      const x = Math.round(mouse + (targetMouse - mouse) * (i / steps) + (Math.random() - 0.5) * 2);
      const y = sy + Math.floor(Math.random() * 5) - 2;
      sh(`xdotool mousemove ${x} ${y}`);
      await sleep(15 + Math.floor(Math.random() * 25));
    }
    mouse = targetMouse;
    await sleep(150 + Math.floor(Math.random() * 200));
    const off = await blockOff();
    if (typeof off === "number" && off > 0) {
      const err = targetCss - off;
      if (Math.abs(err) > 1.5 && Math.abs(err) < 40) {
        const fix = Math.round(mouse + err / 0.92);
        const n2 = Math.max(2, Math.min(5, Math.round(Math.abs(fix - mouse) / 3) + 1));
        for (let i = 1; i <= n2; i++) {
          const x = Math.round(mouse + (fix - mouse) * (i / n2));
          sh(`xdotool mousemove ${x} ${sy}`);
          await sleep(20 + Math.floor(Math.random() * 30));
        }
        mouse = fix;
        await sleep(150);
      }
    }
  }
  const off2 = await blockOff();
  if (typeof off2 === "number") {
    const err = targetCss - off2;
    if (Math.abs(err) > 0.6 && Math.abs(err) < 30) {
      sh(`xdotool mousemove ${Math.round(mouse + err / 0.92)} ${sy}`);
      await sleep(200);
    }
  }
  await sleep(150 + Math.floor(Math.random() * 200));
  sh(`xdotool mouseup 1`);
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
  for (let attempt = 1; attempt <= 5 && st === "slider"; attempt++) {
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
log("slider solved, searching keywords: " + KEYWORDS.join(","));
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
