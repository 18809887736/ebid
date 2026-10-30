const task = await taskSpace(21);
const page = task.page("p1");

await page.waitForTimeout(3000);
console.log({
  title: await page.title(),
  url: await page.url(),
  info: await page.info(),
});
console.log(await page.snapshot());

const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 3000));
console.log({ bodyText });
