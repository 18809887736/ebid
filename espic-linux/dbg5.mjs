const targets = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const cdp = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error("to " + method)); } }, 30000); });
const ev = async (js) => { const r = await cdp("Runtime.evaluate", { expression: js, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 150)); return r.result.result.value; };
import { execSync } from "node:child_process";
const XSH = { shell: "/bin/bash", encoding: "utf8" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const blockInfo = () => ev(`(() => { const d = document.querySelector('iframe').contentDocument; const b = d.querySelector('canvas.block'); const g = [...d.querySelectorAll('canvas')].find(c => !c.classList.contains('block')); const cont = d.querySelector('.sliderContainer'); return { off: +(b.getBoundingClientRect().x - g.getBoundingClientRect().x).toFixed(1), cls: cont.className, mask: d.querySelector('.sliderMask')?.style?.width || '' }; })()`);
const log = (m) => console.log("[dbg5] " + m);

await cdp("Page.enable");
await cdp("Page.navigate", { url: "https://ebid.espic.com.cn/newgdtcms//category/bulletinListNew.html?dates=300&categoryId=2&tenderMethod=01&tabName=%E6%8B%9B%E6%A0%87%E4%BF%A1%E6%81%AF&page=1" });
for (let i = 0; i < 25; i++) {
  await sleep(3000);
  const s = await ev("(() => { const d = document.querySelector('iframe')?.contentDocument; const t = d?.body?.innerText || ''; if (d && (t.includes('向右滑动') || d.querySelector('.slider'))) return 'slider'; return 'other'; })()");
  if (s === "slider") break;
}
await ev(`(() => { const ifr = document.querySelector("iframe"); ifr.scrollIntoView({ block: "center" }); ifr.contentDocument.querySelector(".slidercaptcha")?.scrollIntoView({ block: "center" }); return 1; })()`);
await sleep(500);
const geo = await ev(`(() => { const ifr = document.querySelector("iframe"); const fr = ifr.getBoundingClientRect(); const doc = ifr.contentDocument; const sr = doc.querySelector(".slider").getBoundingClientRect(); return { sx: 0, oh: window.outerHeight, ih: window.innerHeight, hx: fr.x + sr.x + sr.width/2, hy: fr.y + sr.y + sr.height/2 }; })()`);
const sx = Math.round(geo.hx), sy = Math.round(geo.oh - geo.ih + geo.hy);
log("start " + sx + "," + sy);
const wid = execSync('xdotool search --onlyvisible --name "." | head -1', XSH).trim();
execSync('xdotool windowfocus ' + wid, XSH);
await sleep(300);
execSync('xdotool mousemove ' + sx + ' ' + sy, XSH);
await sleep(300);
execSync('xdotool mousedown 1', XSH);
await sleep(250);
for (let i = 1; i <= 40; i++) {
  execSync('xdotool mousemove ' + (sx + i * 4) + ' ' + sy, XSH);
  await sleep(20 + Math.floor(Math.random() * 20));
  if (i % 4 === 0) {
    const bi = await blockInfo();
    log("step" + (i * 4) + "px " + JSON.stringify(bi));
    if (bi.cls.includes("fail") || bi.cls.includes("success")) break;
  }
}
execSync('xdotool mouseup 1', XSH);
await sleep(2000);
log("final " + JSON.stringify(await blockInfo()));
process.exit(0);
