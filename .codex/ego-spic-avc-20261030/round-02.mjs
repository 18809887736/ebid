const task = await taskSpace(10);
const page = task.page("p1");

await page.reload();
await page.waitForFunction(() => document.body?.innerText.trim().length > 0, undefined, {
  timeout: 20000,
}).catch(() => null);
await page.waitForTimeout(5000);

const state = await page.evaluate(() => ({
  title: document.title,
  readyState: document.readyState,
  href: location.href,
  textLength: document.body?.innerText.trim().length || 0,
  controls: [...document.querySelectorAll("input,button,a")]
    .map((node) => ({
      tag: node.tagName.toLowerCase(),
      id: node.id,
      name: node.getAttribute("name"),
      type: node.getAttribute("type"),
      placeholder: node.getAttribute("placeholder"),
      className: node.className,
      value: node instanceof HTMLInputElement ? node.value : undefined,
      text: node.textContent?.replace(/\s+/g, " ").trim(),
      onclick: node.getAttribute("onclick"),
      href: node instanceof HTMLAnchorElement ? node.getAttribute("href") : undefined,
    }))
    .filter((item) =>
      item.placeholder?.includes("搜索") ||
      item.text === "搜索" ||
      item.text?.includes("AVC") ||
      item.value?.includes("AVC"),
    ),
  bodyText: document.body?.innerText.slice(0, 8000) || "",
}));

console.log(JSON.stringify(state, null, 2));
