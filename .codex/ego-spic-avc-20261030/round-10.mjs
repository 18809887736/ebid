import { writeFile } from "node:fs/promises";

const task = await taskSpace(10);
const page = task.page("p1");

const images = await page.evaluate(() => {
  const doc = document.querySelector("#iframe")?.contentDocument;
  const background = doc?.querySelector("canvas:not(.block)");
  const block = doc?.querySelector("canvas.block");
  return {
    background: background?.toDataURL("image/png"),
    block: block?.toDataURL("image/png"),
  };
});

function decodeDataUrl(dataUrl) {
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

if (!images.background || !images.block) throw new Error("Captcha images not found");
await writeFile("C:/work/ebid/.codex/ego-spic-avc-20261030/background.png", decodeDataUrl(images.background));
await writeFile("C:/work/ebid/.codex/ego-spic-avc-20261030/block.png", decodeDataUrl(images.block));
console.log({ saved: true, backgroundBytes: decodeDataUrl(images.background).length, blockBytes: decodeDataUrl(images.block).length });
