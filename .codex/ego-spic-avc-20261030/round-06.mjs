const task = await taskSpace(10);
const page = task.page("p1");

const puzzle = await page.evaluate(() => {
  const frame = document.querySelector("#iframe");
  const doc = frame?.contentDocument;
  const win = doc?.defaultView;
  const frameBox = frame?.getBoundingClientRect();
  if (!doc || !win || !frameBox) return null;

  const canvases = [...doc.querySelectorAll("canvas")];
  const background = canvases[0];
  const block = canvases.find((node) => node.classList.contains("block"));
  const slider = doc.querySelector(".slider");
  const sliderBox = slider?.getBoundingClientRect();
  if (!background || !block || !sliderBox) return null;

  const imageData = background.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, background.width, background.height);
  const pixels = imageData.data;
  const columnScore = [];
  for (let x = block.width; x < background.width - 2; x++) {
    let score = 0;
    for (let y = 0; y < background.height; y++) {
      const i = (y * background.width + x) * 4;
      const left = (y * background.width + Math.max(0, x - 3)) * 4;
      score += Math.abs(pixels[i] - pixels[left]) + Math.abs(pixels[i + 1] - pixels[left + 1]) + Math.abs(pixels[i + 2] - pixels[left + 2]);
    }
    columnScore.push({ x, score });
  }
  columnScore.sort((a, b) => b.score - a.score);

  return {
    backgroundWidth: background.width,
    backgroundHeight: background.height,
    blockWidth: block.width,
    blockBox: { x: block.getBoundingClientRect().x, y: block.getBoundingClientRect().y },
    sliderBox: { x: Math.round(sliderBox.x), y: Math.round(sliderBox.y), w: Math.round(sliderBox.width), h: Math.round(sliderBox.height) },
    frameBox: { x: Math.round(frameBox.x), y: Math.round(frameBox.y), w: Math.round(frameBox.width), h: Math.round(frameBox.height) },
    candidates: columnScore.slice(0, 15),
  };
});

if (!puzzle) throw new Error("Captcha elements not found");
console.log(JSON.stringify({ puzzle }, null, 2));

const targetX = puzzle.frameBox.x + 308 + puzzle.candidates[0].x;
const startX = puzzle.frameBox.x + puzzle.sliderBox.x;
const startY = puzzle.frameBox.y + puzzle.sliderBox.y + Math.round(puzzle.sliderBox.h / 2);
const distance = Math.max(50, targetX - startX - 20);

await page.mouse.move(startX, startY, { label: "move to captcha slider" });
await page.mouse.down();
for (let step = 1; step <= 20; step++) {
  const progress = step / 20;
  const eased = 1 - Math.pow(1 - progress, 3);
  const jitter = step < 20 ? (Math.random() - 0.5) * 2 : 0;
  await page.mouse.move(startX + distance * eased + jitter, startY + (Math.random() - 0.5) * 2);
  await page.waitForTimeout(35 + Math.floor(Math.random() * 35));
}
await page.mouse.up();

await page.waitForTimeout(3000);
const result = await page.evaluate(() => {
  const doc = document.querySelector("#iframe")?.contentDocument;
  return {
    captchaVisible: !!doc?.querySelector("#slideCode") && doc.querySelector("#slideCode").style.display !== "none",
    text: doc?.body?.innerText.replace(/\s+/g, " ").slice(0, 1000),
  };
});
console.log(JSON.stringify({ targetX, startX, startY, distance, result }, null, 2));
