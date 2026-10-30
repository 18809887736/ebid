const task = await taskSpace("cdt-ec ua check");
const page = task.page("p1");
const ua = await page.evaluate(() => navigator.userAgent);
console.log("UA:", ua);
console.log("PLATFORM:", await page.evaluate(() => navigator.platform));
console.log("LANG:", await page.evaluate(() => navigator.language));
try { await task.finish({ keep: [] }); } catch {}
