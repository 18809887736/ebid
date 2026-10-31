const task = await taskSpace(10);
const page = task.page("p1");

const state = await page.evaluate(() => {
  const frame = document.querySelector("#iframe");
  const doc = frame?.contentDocument;
  const win = doc?.defaultView;
  if (!doc || !win) return null;
  const block = doc.querySelector("canvas.block");
  const slider = doc.querySelector(".slider");
  const sliderMask = doc.querySelector(".sliderMask");
  if (!block || !slider || !sliderMask) return null;
  const boxOf = (node) => {
    const box = node.getBoundingClientRect();
    return { x: box.x, y: box.y, w: box.width, h: box.height };
  };
  const computed = (node) => {
    const raw = win.getComputedStyle(node);
    return { transform: raw.transform, left: raw.left, width: raw.width };
  };
  return {
    block: { box: boxOf(block), computed: computed(block) },
    slider: { box: boxOf(slider), computed: computed(slider) },
    sliderMask: { box: boxOf(sliderMask), computed: computed(sliderMask) },
    html: doc.documentElement.outerHTML.slice(-12000),
  };
});

console.log(JSON.stringify(state, null, 2));
