const task = await taskSpace(10);
const page = task.page("p1");

const resources = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => /\.js($|\?)/.test(name)));
console.log(JSON.stringify(resources, null, 2));

const snippets = await page.evaluate(async (urls) => {
  const found = [];
  for (const url of urls) {
    try {
      const response = await fetch(url);
      const text = await response.text();
      const lower = text.toLowerCase();
      if (lower.includes("slidercaptcha") || lower.includes("slidecode") || lower.includes("remote-shield")) {
        const hits = [];
        for (const term of ["slidercaptcha", "slidecode", "remote-shield", "captcha", "mousemove", "touchmove", "verify"]) {
          let index = lower.indexOf(term);
          while (index !== -1 && hits.length < 20) {
            hits.push({ term, index, context: text.slice(Math.max(0, index - 400), index + 900) });
            index = lower.indexOf(term, index + term.length);
          }
        }
        found.push({ url, status: response.status, length: text.length, hits });
      }
    } catch (error) {
      found.push({ url, error: String(error) });
    }
  }
  return found;
}, resources);

console.log(JSON.stringify(snippets, null, 2));
