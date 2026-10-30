const task = await taskSpace("cdt-ec zh-CN test");
const page = task.page("p1");

await page.cdp("Network.setUserAgentOverride", {
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
  acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8",
});
console.log("LANG SET zh-CN");

await page.goto("https://www.cdt-ec.com/notice/moreController/toMore?globleType=0", { timeout: 45000 });
await page.waitForTimeout(15000);

const st = await page.evaluate(() => ({
  lang: navigator.language,
  trs: document.querySelectorAll("tbody tr").length,
  hasInput: !!document.querySelector("#title"),
}));
console.log("PAGE lang:", st.lang, "| default rows:", st.trs, "| #title:", st.hasInput);

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
await page.waitForTimeout(2000);
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("button, a, input[type=button]")).find(b => {
    const t = (b.textContent || b.value || "").replace(/\s+/g, "");
    return t.indexOf("搜索") >= 0;
  });
  if (btn) btn.click();
});
await page.waitForTimeout(9000);

const out = await page.evaluate(() => ({
  cap: window.__cap || [],
  trs: document.querySelectorAll("tbody tr").length,
  text: (document.body.innerText || "").replace(/\s+/g, " "),
}));
for (const c of out.cap) console.log("XHR:", (c || "").slice(0, 200));
console.log("ROWS AFTER SEARCH:", out.trs);
const yc = out.text.indexOf("阳城") >= 0;
const ycXhr = out.cap.some(c => (c || "").indexOf("阳城") >= 0);
console.log("YANGCHENG:", yc ? "in DOM" : (ycXhr ? "in XHR" : "not found"));
if (yc) console.log("CONTEXT:", out.text.slice(Math.max(0, out.text.indexOf("阳城") - 60), out.text.indexOf("阳城") + 130));
try { await task.finish({ keep: [] }); } catch {}
