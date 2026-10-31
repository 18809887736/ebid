const task = await taskSpace(10);
const page = task.page("p1");

const state = await page.evaluate(() => {
  const frame = document.querySelector("#iframe");
  const doc = frame?.contentDocument;
  const win = doc?.defaultView;
  if (!doc || !win) return { accessible: false };
  const rect = frame.getBoundingClientRect();
  const nodes = [...doc.querySelectorAll("body *")].map((node) => {
    const box = node.getBoundingClientRect();
    const style = win.getComputedStyle(node);
    return {
      tag: node.tagName.toLowerCase(),
      id: node.id,
      className: node.className,
      text: node.textContent?.replace(/\s+/g, " ").trim().slice(0, 100),
      visible: style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0,
      box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
    };
  }).filter((item) => item.visible);
  return {
    accessible: true,
    frameBox: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    nodes,
    html: doc.body.outerHTML.slice(0, 12000),
  };
});

console.log(JSON.stringify(state, null, 2));
const shot = await page.screenshot({ path: "C:/work/ebid/.codex/ego-spic-avc-20261030/captcha.png" });
console.log({ screenshot: shot });
