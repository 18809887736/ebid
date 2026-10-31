const task = await taskSpace(10);
const page = task.page("p1");

const before = await page.evaluate(() => {
  const doc = document.querySelector("#iframe")?.contentDocument;
  const refresh = doc?.querySelector(".refreshIcon");
  refresh?.click();
  const background = doc?.querySelector("canvas:not(.block)");
  return {
    clicked: !!refresh,
    backgroundLoaded: !!background && background.width > 0 && background.toDataURL().length > 5000,
    dataLength: background?.toDataURL().length || 0,
  };
});
console.log(JSON.stringify(before));

await page.waitForTimeout(3000);

const puzzle = await page.evaluate(() => {
  const frame = document.querySelector("#iframe");
  const doc = frame?.contentDocument;
  const win = doc?.defaultView;
  const frameBox = frame?.getBoundingClientRect();
  if (!doc || !win || !frameBox) return null;

  const background = doc.querySelector("canvas:not(.block)");
  const block = doc.querySelector("canvas.block");
  const slider = doc.querySelector(".slider");
  const sliderBox = slider?.getBoundingClientRect();
  if (!background || !block || !sliderBox) return null;

  const ctx = background.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, background.width, background.height);
  const pixels = imageData.data;
  const nonBlankColumns = [];
  const rowScore = [];
  for (let y = 1; y < background.height - 1; y++) {
    let score = 0;
    for (let x = 0; x < background.width; x++) {
      const i = (y * background.width + x) * 4;
      const up = ((y - 1) * background.width + x) * 4;
      score += Math.abs(pixels[i] - pixels[up]) + Math.abs(pixels[i + 1] - pixels[up + 1]) + Math.abs(pixels[i + 2] - pixels[up + 2]);
    }
    rowScore.push({ y, score });
  }
  const top = Math.min(10, Math.max(...rowScore.map((item) => item.y)));
  const bottom = Math.min(background.height - 1, top + block.height - 1);
  const columnScore = [];
  for (let x = block.width; x < background.width - 3; x++) {
    let score = 0;
    for (let y = top; y <= bottom; y++) {
      const i = (y * background.width + x) * 4;
      const left = (y * background.width + Math.max(0, x - 3)) * 4;
      score += Math.abs(pixels[i] - pixels[left]) + Math.abs(pixels[i + 1] - pixels[left + 1]) + Math.abs(pixels[i + 2] - pixels[left + 2]);
    }
    columnScore.push({ x, score });
  }
  columnScore.sort((a, b) => b.score - a.score);

  return {
    dataLength: background.toDataURL().length,
    backgroundWidth: background.width,
    backgroundHeight: background.height,
    blockWidth: block.width,
    sliderBox: { x: Math.round(sliderBox.x), y: Math.round(sliderBox.y), w: Math.round(sliderBox.width), h: Math.round(sliderBox.height) },
    frameBox: { x: Math.round(frameBox.x), y: Math.round(frameBox.y), w: Math.round(frameBox.width), h: Math.round(frameBox.height) },
    top,
    bottom,
    candidates: columnScore.slice(0, 20),
  };
});

console.log(JSON.stringify({ puzzle }, null, 2));

const best = puzzle.candidates[0];
const targetX = puzzle.frameBox.x + 308 + best.x;
const startX = puzzle.frameBox.x + puzzle.sliderBox.x;
const startY = puzzle.frameBox.y + puzzle.sliderBox.y + Math.round(puzzle.sliderBox.h / 2);
const distance = best.x - 16;

await page.mouse.move(startX, startY, { label: "move to refreshed captcha slider" });
await page.mouse.down();
for (let step = 1; step <= 24; step++) {
  const progress = step / 24;
  const eased = progress < 0.7 ? progress * 1.15 : 0.805 + (progress - 0.7) * 0.65;
  const jitter = step < 24 ? (Math.random() - 0.5) * 1.6 : 0;
  await page.mouse.move(startX + Math.min(distance, distance * eased) + jitter, startY + (Math.random() - 0.5) * 2);
  await page.waitForTimeout(30 + Math.floor(Math.random() * 40));
}
await page.mouse.up();

await page.waitForTimeout(3000);
const result = await page.evaluate(() => {
  const doc = document.querySelector("#iframe")?.contentDocument;
  return {
    captchaVisible: !!doc?.querySelector("#slideCode") && doc.querySelector("#slideCode").style.display !== "none",
    text: doc?.body?.innerText.replace(/\s+/g, " ").slice(0, 2000),
  };
});
console.log(JSON.stringify({ targetX, startX, startY, distance, result }, null, 2));
