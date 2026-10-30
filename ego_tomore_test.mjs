const task = await taskSpace("cdt-ec toMore test");
const page = task.page("p1");

await page.goto("https://www.cdt-ec.com/notice/moreController/toMore?globleType=0", { timeout: 45000 });
await page.waitForTimeout(12000);

const st = await page.evaluate(() => ({
  title: document.title,
  trs: document.querySelectorAll("tbody tr").length,
  inputs: Array.from(document.querySelectorAll("input[type=text]")).map(i => i.id || i.placeholder).slice(0, 10),
}));
console.log("PAGE:", st.title, "| default rows:", st.trs);
console.log("INPUTS:", JSON.stringify(st.inputs));

await page.evaluate(() => {
  window.__cap = [];
  const orig = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) {
    this.addEventListener("load", function () {
      try { window.__cap.push((this.responseText || "").slice(0, 600)); } catch (e) {}
    });
    return orig.apply(this, arguments);
  };
  const inp = document.querySelector("#title");
  if (inp) { inp.focus(); inp.value = "AVC"; }
});
await page.waitForTimeout(1500);
const clicked = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("button, a, input[type=button]")).find(b => {
    const t = (b.textContent || b.value || "").replace(/\s+/g, "");
    return t.indexOf("搜索") >= 0;
  });
  if (btn) { btn.click(); return (btn.textContent || btn.value || "").trim(); }
  return null;
});
console.log("CLICKED:", clicked);
await page.waitForTimeout(8000);

const out = await page.evaluate(() => ({
  cap: window.__cap || [],
  trs: document.querySelectorAll("tbody tr").length,
  text: (document.body.innerText || "").replace(/\s+/g, " "),
}));
for (const c of out.cap) console.log("XHR:", (c || "").slice(0, 150));
console.log("ROWS AFTER SEARCH:", out.trs);
const yc = out.text.indexOf("阳城") >= 0;
const ycXhr = out.cap.some(c => (c || "").indexOf("阳城") >= 0);
console.log("YANGCHENG:", yc ? "in DOM" : (ycXhr ? "in XHR" : "not found"));
if (yc || ycXhr) {
  const line = out.text.slice(Math.max(0, out.text.indexOf("阳城") - 60), out.text.indexOf("阳城") + 120);
  console.log("CONTEXT:", line);
}
try { await task.finish({ keep: [] }); } catch {}
