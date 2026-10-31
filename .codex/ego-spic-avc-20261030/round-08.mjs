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

  const pixels = background.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, background.width, background.height).data;
  const blockPixels = block.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, block.width, block.height).data;
  const blockAlphaCount = [];
  for (let y = 0; y < block.height; y++) {
    let count = 0;
    for (let x = 0; x < block.width; x++) {
      if (blockPixels[(y * block.width + x) * 4 + 3] > 0) count++;
    }
    blockAlphaCount.push(count);
  }
  const usefulRows = blockAlphaCount.map((count, y) => ({ y, count })).filter((row) => row.count > 10);
  const top = usefulRows[0]?.y || 0;
  const bottom = usefulRows.at(-1)?.y || block.height - 1;

  const columnScore = [];
  for (let x = block.width; x < background.width - 5; x++) {
    let score = 0;
    for (let y = top; y <= bottom; y++) {
      let rowDiff = 0;
      for (let dx = 0; dx < 3; dx++) {
        const bgI = (y * background.width + Math.min(background.width - 1, x + dx)) * 4;
        const leftI = (y * background.width + Math.max(0, x + dx - 4)) * 4;
        rowDiff += Math.abs(pixels[bgI] - pixels[leftI]) + Math.abs(pixels[bgI + 1] - pixels[leftI + 1]) + Math.abs(pixels[bgI + 2] - pixels[leftI + 2]);
      }
      score += rowDiff;
      if (score > 100000) break;
    }
    columnScore.push({ x, score });
  }
  columnScore.sort((a, b) => b.score - a.score);

  return {
    dataLength: background.toDataURL().length,
    blockWidth: block.width,
    backgroundWidth: background.width,
    usefulRows: usefulRows.length,
    top,
    bottom,
    candidates: columnScore.filter((item) => item.x < background.width - 20).slice(0, 25),
  };
});

if (!puzzle) throw new Error("Captcha elements not found");
console.log(JSON.stringify({ puzzle }, null, 2));

const candidate = puzzle.candidates.find((item) => item.x < puzzle.backgroundWidth - 25) || puzzle.candidates[0];
const distance = candidate.x - 18;
const startX = puzzle.frameBox?.x ? puzzle.frameBox.x + 308 : 601;
const startY = puzzle.frameBox?.y ? puzzle.frameBox.y + 256 + 20 : 464;

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
