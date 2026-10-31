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
    start: { x: frameBox.x + sliderBox.x, y: frameBox.y + sliderBox.y + sliderBox.height / 2 },
    distance: 118,
  };
});

if (!state) throw new Error("Slider not found");
const startX = state.start.x;
const startY = state.start.y;

await page.mouse.move(startX, startY, { label: "move to slider" });
await page.mouse.down();
for (let step = 1; step <= 28; step++) {
  const progress = step / 28;
  const eased = 1 - Math.pow(1 - progress, 2.7);
  const jitter = step < 28 ? (Math.random() - 0.5) * 1.2 : 0;
  await page.mouse.move(startX + state.distance * eased + jitter, startY + (Math.random() - 0.5) * 1.2);
  await page.waitForTimeout(28 + Math.floor(Math.random() * 32));
}
await page.mouse.up();
await page.waitForTimeout(3000);

const result = await page.evaluate(() => {
  const doc = document.querySelector("#iframe")?.contentDocument;
  return {
    captchaVisible: !!doc?.querySelector("#slideCode") && doc.querySelector("#slideCode").style.display !== "none",
    text: doc?.body?.innerText.replace(/\s+/g, " ").slice(0, 5000),
  };
});
console.log(JSON.stringify({ startX, startY, distance: state.distance, result }, null, 2));
