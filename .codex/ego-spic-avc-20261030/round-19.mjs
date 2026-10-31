const task = await taskSpace(10);
const page = task.page("p1");

const state = await page.evaluate(() => {
  const frame = document.querySelector("#iframe");
  const doc = frame?.contentDocument;
  const frameBox = frame?.getBoundingClientRect();
  const slider = doc?.querySelector(".slider");
  const sliderBox = slider?.getBoundingClientRect();
  if (!frameBox || !sliderBox) return null;
  return {
    startX: frameBox.x + sliderBox.x + 20,
    startY: frameBox.y + sliderBox.y + 20,
    distance: 68,
  };
});
if (!state) throw new Error("Slider not found");

await page.mouse.move(state.startX, state.startY, { label: "move to captcha slider" });
await page.mouse.down();
for (let step = 1; step <= 18; step++) {
  const progress = step / 18;
  const eased = 1 - Math.pow(1 - progress, 2.4);
  await page.mouse.move(state.startX + state.distance * eased, state.startY + (Math.random() - 0.5) * 0.8);
  await page.waitForTimeout(30 + Math.floor(Math.random() * 30));
}
await page.mouse.up();
await page.waitForTimeout(3000);

const result = await page.evaluate(() => {
  const doc = document.querySelector("#iframe")?.contentDocument;
  return {
    captchaVisible: !!doc?.querySelector("#slideCode") && doc.querySelector("#slideCode").style.display !== "none",
    text: doc?.body?.innerText.replace(/\s+/g, " ").slice(0, 6000),
  };
});
console.log(JSON.stringify({ state, result }, null, 2));
