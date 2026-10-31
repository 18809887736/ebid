const task = await taskSpace(10);
const page = task.page("p1");

const scripts = await page.evaluate(() => {
  const doc = document.querySelector("#iframe")?.contentDocument;
  return [...doc.querySelectorAll("script")].map((node) => ({
    src: node.src,
    length: node.textContent.length,
    content: node.src ? "" : node.textContent.slice(0, 30000),
  }));
});

console.log(JSON.stringify(scripts, null, 2));
