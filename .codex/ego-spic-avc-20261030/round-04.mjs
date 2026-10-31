const task = await taskSpace(10);
const page = task.page("p1");

const state = await page.evaluate(() => {
  const frame = document.querySelector("#iframe");
  const doc = frame?.contentDocument;
  if (!doc) return { accessible: false };

  return {
    accessible: true,
    readyState: doc.readyState,
    href: doc.location.href,
    textLength: doc.body?.innerText.trim().length || 0,
    controls: [...doc.querySelectorAll("input,button,a")]
      .map((node) => ({
        tag: node.tagName.toLowerCase(),
        id: node.id,
        name: node.getAttribute("name"),
        type: node.getAttribute("type"),
        placeholder: node.getAttribute("placeholder"),
        className: node.className,
        value: node instanceof doc.defaultView.HTMLInputElement ? node.value : undefined,
        text: node.textContent?.replace(/\s+/g, " ").trim(),
        onclick: node.getAttribute("onclick"),
        href: node instanceof doc.defaultView.HTMLAnchorElement ? node.getAttribute("href") : undefined,
      }))
      .filter((item) =>
        item.placeholder?.includes("搜索") ||
        item.text === "搜索" ||
        item.text?.includes("AVC") ||
        item.value?.includes("AVC"),
      ),
    bodyText: doc.body?.innerText.slice(0, 8000) || "",
  };
});

console.log(JSON.stringify(state, null, 2));
