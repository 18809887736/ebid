const targets = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const cdp = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error("to " + method)); } }, 30000); });
const ev = async (js) => { const r = await cdp("Runtime.evaluate", { expression: js, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 150)); return r.result.result.value; };
import { execSync } from "node:child_process";
const sh = (c) => execSync(c, { shell: "/bin/bash", encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await cdp("Page.enable");
await cdp("Page.navigate", { url: "https://ebid.espic.com.cn/newgdtcms//category/bulletinListNew.html?dates=300&categoryId=2&tenderMethod=01&tabName=%E6%8B%9B%E6%A0%87%E4%BF%A1%E6%81%AF&page=1" });
for (let i = 0; i < 20; i++) {
  await sleep(3000);
  const s = await ev("(() => { const d = document.querySelector('iframe')?.contentDocument; const t = d?.body?.innerText || ''; if (d && (t.includes('向右滑动') || d.querySelector('.slider'))) return 'slider'; return 'other'; })()");
  if (s === "slider") break;
}
await ev(`(() => { const ifr = document.querySelector("iframe"); ifr.scrollIntoView({ block: "center" }); ifr.contentDocument.querySelector(".slidercaptcha")?.scrollIntoView({ block: "center" }); return 1; })()`);
await sleep(500);
const geo = await ev(`(() => {
  const ifr = document.querySelector("iframe");
  const fr = ifr.getBoundingClientRect();
  const doc = ifr.contentDocument;
  const slider = doc.querySelector(".slider");
  const sr = slider.getBoundingClientRect();
  return { screenX: window.screenX, outerH: window.outerHeight, innerH: window.innerHeight, dpr: window.devicePixelRatio, hx: fr.x + sr.x + sr.width/2, hy: fr.y + sr.y + sr.height/2 };
})()`);
const sx = Math.round(geo.hx * geo.dpr);
const sy = Math.round((geo.outerH - geo.innerH) + geo.hy * geo.dpr);
console.log("start:", sx, sy, JSON.stringify(geo));
// 焦点:无 WM 时用 XSetInputFocus
const wid = sh("xdotool search --onlyvisible --name '.' | head -1");
console.log("wid:", wid);
sh(`xdotool windowfocus ${wid}`);
await sleep(300);
sh(`xdotool mousemove ${sx} ${sy}`);
await sleep(300);
sh(`xdotool mousedown 1`);
await sleep(250);
sh(`xdotool mousemove ${sx + 25} ${sy}`);
await sleep(300);
const off1 = await ev("(() => { const d = document.querySelector('iframe').contentDocument; const b = d.querySelector('canvas.block'); const g = [...d.querySelectorAll('canvas')].find(c => !c.classList.contains('block')); return b.getBoundingClientRect().x - g.getBoundingClientRect().x; })()");
console.log("blockOff after +25:", off1);
sh(`xdotool mouseup 1`);
await sleep(1500);
const state = await ev("(() => { const d = document.querySelector('iframe')?.contentDocument; return (d?.body?.innerText || '').slice(0, 40).replace(/\\n/g, '|'); })()");
console.log("state:", JSON.stringify(state));
process.exit(0);
