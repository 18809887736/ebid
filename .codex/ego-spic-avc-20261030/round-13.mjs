const task = await taskSpace(10);
const page = task.page("p1");

const geometry = await page.evaluate(() => {
  const doc = document.querySelector("#iframe")?.contentDocument;
  const win = doc?.defaultView;
  const block = doc?.querySelector("canvas.block");
  const slider = doc?.querySelector(".slider");
  const sliderMask = doc?.querySelector(".sliderMask");
  if (!win || !block || !slider || !sliderMask) return null;
  const style = (node) => {
    const raw = win.getComputedStyle(node);
    return {
      transform: raw.transform,
      left: raw.left,
      marginLeft: raw.marginLeft,
      width: raw.width,
    };
  };
  return {
    block: style(block),
    blockBox: block.getBoundingClientRect(),
    slider: style(slider),
    sliderBox: slider.getBoundingClientRect(),
    sliderMask: style(sliderMask),
    sliderMaskBox: sliderMask.getBoundingClientRect(),
  };
});

console.log(JSON.stringify(geometry, null, 2));
