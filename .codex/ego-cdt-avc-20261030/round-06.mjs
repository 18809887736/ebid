const task = await taskSpace(21);
const page = task.page("p1");

const windowInfo = await task.cdp("Browser.getWindowForTarget", { targetId: page.targetId });
console.log({ windowInfo });

const restored = await task.cdp("Browser.setWindowBounds", {
  windowId: windowInfo.windowId,
  bounds: { windowState: "normal", focused: true },
});
console.log({ restored });

await page.waitForTimeout(500);
const visibility = await page.evaluate(() => {
  const node = document.querySelector("#title");
  const rect = node?.getBoundingClientRect();
  return { viewport: { width: innerWidth, height: innerHeight }, titleValue: node?.value, rect };
});
console.log({ visibility });
