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
const geo = await ev(`(() => {
  const ifr = document.querySelector("iframe");
  const fr = ifr.getBoundingClientRect();
  const doc = ifr.contentDocument;
  const slider = doc.querySelector(".slider");
  const sr = slider.getBoundingClientRect();
  const block = doc.querySelector("canvas.block");
  const bg = [...doc.querySelectorAll("canvas")].find(c => !c.classList.contains("block"));
  return { screenX: window.screenX, screenY: window.screenY, outerH: window.outerHeight, innerH: window.innerHeight, dpr: window.devicePixelRatio, handlePageX: fr.x + sr.x + sr.width/2, handlePageY: fr.y + sr.y + sr.height/2, blockOff: block.getBoundingClientRect().x - bg.getBoundingClientRect().x };
})()`);
console.log("geo:", JSON.stringify(geo));
const sx = Math.round(geo.screenX + geo.handlePageX * geo.dpr);
const sy = Math.round(geo.screenY + (geo.outerH - geo.innerH) + geo.handlePageY * geo.dpr);
console.log("start:", sx, sy, "blockOff0:", geo.blockOff);

sh(`xdotool mousemove ${sx} ${sy}`);
await sleep(200);
sh(`xdotool mousedown 1`);
await sleep(200);
sh(`xdotool mousemove ${sx + 30} ${sy}`);
await sleep(300);
const off1 = await ev("(() => { const d = document.querySelector('iframe').contentDocument; const b = d.querySelector('canvas.block'); const g = [...d.querySelectorAll('canvas')].find(c => !c.classList.contains('block')); return b.getBoundingClientRect().x - g.getBoundingClientRect().x; })()");
console.log("after +30 mousemove, blockOff:", off1);
sh(`xdotool mousemove ${sx + 60} ${sy}`);
await sleep(300);
const off2 = await ev("(() => { const d = document.querySelector('iframe').contentDocument; const b = d.querySelector('canvas.block'); const g = [...d.querySelectorAll('canvas')].find(c => !c.classList.contains('block')); return b.getBoundingClientRect().x - g.getBoundingClientRect().x; })()");
console.log("after +60 mousemove, blockOff:", off2);
sh(`xdotool mouseup 1`);
await sleep(1500);
const state = await ev("(() => { const d = document.querySelector('iframe')?.contentDocument; return (d?.body?.innerText || '').slice(0, 40).replace(/\\n/g, '|'); })()");
console.log("state after mouseup:", JSON.stringify(state));
process.exit(0);
