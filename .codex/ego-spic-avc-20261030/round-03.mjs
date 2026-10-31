const task = await taskSpace(10);
const page = task.page("p1");

const state = await page.evaluate(() => ({
  frames: [...document.querySelectorAll("iframe")].map((node) => ({ src: node.src, id: node.id, className: node.className })),
  resources: performance.getEntriesByType("resource").map((entry) => ({
    name: entry.name,
    initiatorType: entry.initiatorType,
    duration: Math.round(entry.duration),
    transferSize: entry.transferSize,
  })).slice(-100),
  htmlLength: document.documentElement.outerHTML.length,
  bodyHtml: document.body.outerHTML.slice(0, 15000),
}));

console.log(JSON.stringify(state, null, 2));
