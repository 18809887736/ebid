const targets = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const cdp = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error("to " + method)); } }, 30000); });
const ev = async (js) => { const r = await cdp("Runtime.evaluate", { expression: js, returnByValue: true }); return r.result.result.value; };
import { execSync } from "node:child_process";
await cdp("Page.enable");
await cdp("Page.navigate", { url: "https://ebid.espic.com.cn/newgdtcms//category/bulletinListNew.html?dates=300&categoryId=2&tenderMethod=01&tabName=%E6%8B%9B%E6%A0%87%E4%BF%A1%E6%81%AF&page=1" });
for (let i = 0; i < 15; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const s = await ev("(() => { const d = document.querySelector('iframe')?.contentDocument; const t = d?.body?.innerText || ''; if (d && (t.includes('向右滑动') || d.querySelector('.slider'))) return 'slider'; return 'other'; })()");
  if (s === "slider") break;
}
const geo = await ev(`(() => {
  const ifr = document.querySelector("iframe");
  const fr = ifr.getBoundingClientRect();
  const doc = ifr.contentDocument;
  const slider = doc.querySelector(".slider");
  const sr = slider.getBoundingClientRect();
  return { screenX: window.screenX, screenY: window.screenY, outerW: window.outerWidth, outerH: window.outerHeight, innerW: window.innerWidth, innerH: window.innerHeight, dpr: window.devicePixelRatio, handlePageX: Math.round(fr.x + sr.x + sr.width / 2), handlePageY: Math.round(fr.y + sr.y + sr.height / 2) };
})()`);
console.log("JS geo:", JSON.stringify(geo));
const wid = execSync("xdotool search --onlyvisible --name '.' | head -1", { encoding: "utf8" }).trim();
const xg = execSync(`xdotool getwindowgeometry ${wid}; xdotool getwindowgeometry --shell ${wid}`, { encoding: "utf8" }).trim();
console.log("X geo (win " + wid + "):", xg);
// 试探:把光标移到换算坐标,读 :hover
const sx = geo.screenX + geo.handlePageX * geo.dpr;
const chromeH = geo.outerH - geo.innerH;
const sy = geo.screenY + chromeH + geo.handlePageY * geo.dpr;
console.log("computed screen:", sx, sy);
execSync(`xdotool mousemove ${Math.round(sx)} ${Math.round(sy)}`);
await new Promise((r) => setTimeout(r, 500));
const hover = await ev(`(() => { const d = document.querySelector('iframe')?.contentDocument; return [...(d?.querySelectorAll(':hover')||[])].map(e => e.tagName + '.' + (e.className||'')).join(',').slice(-100); })()`);
console.log("hover chain:", JSON.stringify(hover));

process.exit(0);
