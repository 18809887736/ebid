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
  const links = [...document.querySelectorAll("a")]
    .filter((node) => {
      const text = node.textContent || "";
      return text.includes("AVC") || text.includes("山西公司") || text.includes("阳城电厂");
    })
    .map((node) => ({
      text: node.textContent?.replace(/\s+/g, " ").trim(),
      href: node.href,
      html: node.outerHTML,
    }));

  return {
    title: document.title,
    bodyText: document.body.innerText.slice(0, 5000),
    links,
  };
});

console.log({ receipt, url: await page.url() });
console.log(JSON.stringify(results, null, 2));
