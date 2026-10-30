const task = await taskSpace("cdt-avc-monitor-20261030");
const page = task.page("p1");

await page.goto("https://www.cdt-ec.com/notice/moreController/toMore?globleType=0");
await page.waitForLoadState("load");

console.log({
  spaceId: task.spaceId,
  page: page.label,
  title: await page.title(),
  url: await page.url(),
});

console.log(await page.snapshot());
