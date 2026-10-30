const task = await taskSpace(21);
const page = task.page("p1");

const screenshot = await page.screenshot({ path: "C:/work/ebid/.codex/ego-cdt-avc-20261030/current-state.png" });
const visibility = await page.evaluate(() => {
  const node = document.querySelector("#title");
  const rect = node?.getBoundingClientRect();
  const style = node ? getComputedStyle(node) : null;
  return {
    viewport: { width: innerWidth, height: innerHeight },
    titleValue: node?.value,
    rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
    style: style ? { display: style.display, visibility: style.visibility, opacity: style.opacity } : null,
    scrollY,
    searchButtonRect: (() => {
      const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("搜"));
      const rect = button?.getBoundingClientRect();
      return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
    })(),
  };
});

console.log({ screenshot, visibility });
