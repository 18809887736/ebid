const task = await taskSpace(21);
const page = task.page("p1");

const state = await page.evaluate(() => ({
  title: document.querySelector("#title")?.value,
  url: location.href,
  hasResult: document.body.innerText.includes("阳城电厂柳家河"),
  visibleText: document.body.innerText.slice(0, 2000),
}));

console.log(JSON.stringify(state, null, 2));
await task.finish({ keep: ["p1"] });
