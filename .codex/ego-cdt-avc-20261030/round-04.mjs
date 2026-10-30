const task = await taskSpace(21);
const page = task.page("p1");

await page.fill("#title", "AVC");
const receipt = await page.click('button[onclick="search()"]', { label: "click AVC search" });
await page.waitForFunction(
  () => document.body.innerText.includes("AVC") && !document.body.innerText.includes("无数据"),
  undefined,
  { timeout: 15000 },
);

const results = await page.evaluate(() => {
  const text = document.body.innerText;
  const links = [...document.querySelectorAll("a")]
    .filter((node) => node.textContent?.includes("AVC") || node.textContent?.includes("山西公司"))
    .map((node) => ({
      text: node.textContent?.replace(/\s+/g, " ").trim(),
      href: node.href,
      outerHtml: node.outerHTML,
    }));
  return { links, bodyText: text.slice(0, 5000) };
});

console.log({ receipt, url: await page.url() });
console.log(JSON.stringify(results, null, 2));
const screenshot = await page.screenshot({ path: "C:/work/ebid/.codex/ego-cdt-avc-20261030/avc-results.png" });
console.log({ screenshot });
