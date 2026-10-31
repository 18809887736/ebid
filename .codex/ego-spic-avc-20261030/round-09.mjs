const task = await taskSpace(10);
const page = task.page("p1");

await page.evaluate(() => document.querySelector("#iframe")?.contentDocument?.querySelector(".refreshIcon")?.click());
await page.waitForTimeout(3000);

const puzzle = await page.evaluate(() => {
  const frame = document.querySelector("#iframe");
  const doc = frame?.contentDocument;
  const frameBox = frame?.getBoundingClientRect();
  if (!doc || !frameBox) return null;
  const background = doc.querySelector("canvas:not(.block)");
  const block = doc.querySelector("canvas.block");
  const slider = doc.querySelector(".slider");
  const sliderBox = slider?.getBoundingClientRect();
  if (!background || !block || !sliderBox) return null;

  const width = background.width;
  const height = background.height;
  const pixels = background.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  const columnScore = [];
  for (let x = 63; x < width - 25; x++) {
    let score = 0;
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      const left = (y * width + Math.max(0, x - 5)) * 4;
      score += Math.abs(pixels[i] - pixels[left]) + Math.abs(pixels[i + 1] - pixels[left + 1]) + Math.abs(pixels[i + 2] - pixels[left + 2]);
    }
    columnScore.push({ x, score });
  }
  columnScore.sort((a, b) => b.score - a.score);

  return {
    dataLength: background.toDataURL().length,
    blockWidth: block.width,
    backgroundWidth: width,
    sliderBox: { x: Math.round(sliderBox.x), y: Math.round(sliderBox.y), w: Math.round(sliderBox.width), h: Math.round(sliderBox.height) },
    frameBox: { x: Math.round(frameBox.x), y: Math.round(frameBox.y), w: Math.round(frameBox.width), h: Math.round(frameBox.height) },
    candidates: columnScore.slice(0, 30),
  };
});

if (!puzzle) throw new Error("Captcha elements not found");
console.log(JSON.stringify({ puzzle }, null, 2));

const candidate = puzzle.candidates[0];
const distance = candidate.x - 18;
const startX = puzzle.frameBox.x + puzzle.sliderBox.x;
const startY = puzzle.frameBox.y + puzzle.sliderBox.y + Math.round(puzzle.sliderBox.h / 2);

await page.mouse.move(startX, startY, { label: "move to refreshed slider" });
await page.mouse.down();
for (let step = 1; step <= 28; step++) {
  const progress = step / 28;
  const eased = 1 - Math.pow(1 - progress, 2.6);
  const jitter = step < 28 ? (Math.random() - 0.5) * 1.4 : 0;
  await page.mouse.move(startX + distance * eased + jitter, startY + (Math.random() - 0.5) * 1.5);
  await page.waitForTimeout(25 + Math.floor(Math.random() * 35));
}
await page.mouse.up();

await page.waitForTimeout(3000);
const result = await page.evaluate(() => {
  const doc = document.querySelector("#iframe")?.contentDocument;
  return {
    captchaVisible: !!doc?.querySelector("#slideCode") && doc.querySelector("#slideCode").style.display !== "none",
    text: doc?.body?.innerText.replace(/\s+/g, " ").slice(0, 3000),
  };
});
console.log(JSON.stringify({ candidate, startX, startY, distance, result }, null, 2));
