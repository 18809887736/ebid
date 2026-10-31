const task = await taskSpace(10);
const page = task.page("p1");

const initial = await page.evaluate(() => {
  const frame = document.querySelector("#iframe");
  const doc = frame?.contentDocument;
  const frameBox = frame?.getBoundingClientRect();
  const slider = doc?.querySelector(".slider");
  const block = doc?.querySelector("canvas.block");
  if (!frameBox || !slider || !block) return null;
  const sliderBox = slider.getBoundingClientRect();
  return {
    startX: frameBox.x + sliderBox.x + 20,
    startY: frameBox.y + sliderBox.y + 20,
    blockLeft: parseFloat(block.style.left || "0"),
  };
});
if (!initial) throw new Error("Slider not found");

await page.mouse.move(initial.startX, initial.startY, { label: "move to slider" });
await page.mouse.down();
for (let step = 1; step <= 20; step++) {
  await page.mouse.move(initial.startX + step * 5, initial.startY + (Math.random() - 0.5));
  await page.waitForTimeout(25);
}
const mid = await page.evaluate(() => {
  const doc = document.querySelector("#iframe")?.contentDocument;
  return {
    blockLeft: parseFloat(doc?.querySelector("canvas.block")?.style.left || "0"),
    sliderLeft: parseFloat(doc?.querySelector(".slider")?.style.left || "0"),
    maskWidth: parseFloat(doc?.querySelector(".sliderMask")?.style.width || "0"),
  };
});
await page.mouse.up();
const final = await page.evaluate(() => ({
  blockLeft: parseFloat(document.querySelector("#iframe")?.contentDocument?.querySelector("canvas.block")?.style.left || "0"),
  text: document.querySelector("#iframe")?.contentDocument?.body.innerText.replace(/\s+/g, " ").slice(0, 500),
}));
console.log(JSON.stringify({ initial, mid, final }, null, 2));
