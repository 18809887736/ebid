const task = await taskSpace("spic-avc-monitor-20261030-1220");
const page = task.page("p1");

console.log({ taskSpaceId: task.spaceId, page: page.label });
await page.goto("https://ebid.espic.com.cn/newgdtcms//category/bulletinListNew.html?dates=300&categoryId=2&tenderMethod=01&tabName=%E6%8B%9B%E6%A0%87%E4%BF%A1%E6%81%AF&page=1");
await page.waitForLoadState();

const state = await page.evaluate(() => ({
  title: document.title,
  href: location.href,
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
  bodyText: document.body.innerText.slice(0, 5000),
}));

console.log(JSON.stringify(state, null, 2));
