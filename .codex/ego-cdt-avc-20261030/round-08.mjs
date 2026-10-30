const task = await taskSpace(21);
const page = task.page("p1");

const state = await page.evaluate(() => ({
  titleValue: document.querySelector("#title")?.value,
  searchSource: typeof search === "function" ? search.toString() : null,
  tableText: [...document.querySelectorAll("table")].map((node) => node.innerText.trim()).filter(Boolean),
  pageText: document.body.innerText.slice(0, 5000),
  activeElement: document.activeElement?.outerHTML,
}));

const screenshot = await page.screenshot({ path: "C:/work/ebid/.codex/ego-cdt-avc-20261030/after-search.png" });
console.log(JSON.stringify(state, null, 2));
console.log({ screenshot });
