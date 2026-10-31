import { writeFile } from "node:fs/promises";

const task = await taskSpace(10);
const page = task.page("p1");

await page.evaluate(() => document.querySelector("#iframe")?.contentDocument?.querySelector(".refreshIcon")?.click());
await page.waitForTimeout(2500);

const puzzle = await page.evaluate(() => {
  const frame = document.querySelector("#iframe");
  const doc = frame?.contentDocument;
  const frameBox = frame?.getBoundingClientRect();
  const background = doc?.querySelector("canvas:not(.block)");
  const block = doc?.querySelector("canvas.block");
  const slider = doc?.querySelector(".slider");
  const sliderBox = slider?.getBoundingClientRect();
  if (!frameBox || !background || !block || !sliderBox) return null;
  return {
    backgroundPng: background.toDataURL("image/png"),
    blockPng: block.toDataURL("image/png"),
    startX: frameBox.x + sliderBox.x + 20,
    startY: frameBox.y + sliderBox.y + 20,
  };
});
if (!puzzle) throw new Error("Captcha not found");

function decode(dataUrl) {
  return Buffer.from(dataUrl.split(",")[1], "base64");
}
await writeFile("C:/work/ebid/.codex/ego-spic-avc-20261030/target-background.png", decode(puzzle.backgroundPng));
await writeFile("C:/work/ebid/.codex/ego-spic-avc-20261030/target-block.png", decode(puzzle.blockPng));
delete puzzle.backgroundPng;
delete puzzle.blockPng;
console.log(JSON.stringify(puzzle));
