// cdt-ec RPA via ego-browser: real Chromium passes 瑞数; data read via in-page POST
// (layui table renders 无数据 under automation, so the UI table is not a reliable read path).
import { appendFile } from "node:fs/promises";

const LOG = "C:/work/ebid/ebid-monitor/data/cdt_rpa.log";
const URL = "https://www.cdt-ec.com/notice/moreController/toMore?globleType=0";
const KEYWORD = "AVC";
const EXPECT = "阳城";

function ts() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())},${p(d.getMilliseconds(), 3)}`;
}
async function log(msg) {
  const line = `${ts()} [cdt-rpa] [INFO] ${msg}\n`;
  console.log(line.trim());
  await appendFile(LOG, line, "utf8").catch((e) => console.log(`(日志写入失败: ${e})`));
}

await log("开始 RPA 采集 cdt-ec(ego-browser 真实浏览器)");
const day = ts().slice(0, 10).replaceAll("-", "");
const task = await taskSpace(`cdt-ec-rpa-${day}`);
const page = task.page("p1");
await page.goto(URL, { timeout: 60000 });
await page.waitForLoadState("load", { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(5000);
await log(`页面已打开: ${await page.title()}`);

await page.fill('input[placeholder="公告标题"]', KEYWORD);
await page.evaluate(() => { if (typeof search === "function") search(); });
await page.waitForTimeout(9000);
await log("已点击搜索,读取结果");

let found = null;
try {
  const res = await page.fetch("/notice/moreController/getList", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest" },
    body: `page=1&limit=10&messagetype=0&startDate=&endDate=&message_title=${encodeURIComponent(KEYWORD)}&purchase_unit=&purchase_unit_agent=&purchase_code=&purchase_type=&message_no=&pro_bidding_mothod=`,
    timeout: 20000,
  });
  const json = JSON.parse(res.body || "{}");
  const rows = json.data || [];
  await log(`搜索 ${KEYWORD} 返回 ${rows.length} 条`);
  found = rows.find((r) => (r.message_title || "").includes(EXPECT)) || null;
  if (found) {
    await log(`命中${EXPECT}公告: ${found.message_title}, 招标编码: ${found.message_no}, 招标单位: ${found.bid_tenderer}, 售卖截止: ${found.deadline}, 发布时间: ${found.publish_time}`);
  } else if (rows.length) {
    await log(`未找到${EXPECT}, 最新一条: ${rows[0].message_title} (${rows[0].publish_time})`);
  }
} catch (e) {
  await log(`getList 读取失败: ${e.message || e}`);
}

if (!found) {
  await log(`页面文本中未找到${EXPECT}(截图留存页面状态)`);
  await page.screenshot({ path: "C:/work/ebid/ebid-monitor/data/cdt_rpa_fail.png" });
  await log("已截图: C:/work/ebid/ebid-monitor/data/cdt_rpa_fail.png");
}

await task.finish({ keep: [] });
if (!found) process.exitCode = 1;
