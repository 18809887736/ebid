const task = await taskSpace(21);
const page = task.page("p1");

const controls = await page.evaluate(() => ({
  inputs: [...document.querySelectorAll("input, textarea")].slice(0, 30).map((node, index) => ({
    index,
    tag: node.tagName,
    type: node.getAttribute("type"),
    id: node.id,
    name: node.getAttribute("name"),
    placeholder: node.getAttribute("placeholder"),
    className: node.className,
    value: node.value,
  })),
  buttons: [...document.querySelectorAll("button, a, input[type=button], input[type=submit]")].slice(0, 40).map((node, index) => ({
    index,
    tag: node.tagName,
    id: node.id,
    className: node.className,
    text: node.textContent?.trim(),
    type: node.getAttribute("type"),
    onclick: node.getAttribute("onclick"),
  })),
}));

console.log(JSON.stringify(controls, null, 2));
