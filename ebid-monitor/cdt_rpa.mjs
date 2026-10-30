// cdt-ec + chdtp RPA via ego-browser: real Chromium passes 瑞数; data read via in-page
// POST/injected iframe (layui table renders 无数据 under automation, UI table unreliable).
// Final hit lines also append to app.log so patrol results land in the monitor's log.
import { appendFile, readFile } from "node:fs/promises";

const LOG = "C:/work/ebid/ebid-monitor/data/cdt_rpa.log";
const APP_LOG = "C:/work/ebid/ebid-monitor/data/app.log";
const URL = "https://www.cdt-ec.com/notice/moreController/toMore?globleType=0";
const CHD_URL = "https://www.chdtp.com/pages/wzglS/cgxx/caigou.jsp?cgtype=4";

// 搜索词/期望命中从 config.yaml rpa_check 块读取(只解析该块内的平铺 key: value)
const lines = (await readFile("C:/work/ebid/ebid-monitor/config.yaml", "utf8")).split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith("rpa_check:"));
const cfg = {};
for (const l of lines.slice(start + 1)) {
  if (/^\S/.test(l)) break;
  const m = l.match(/^\s+(\w+):\s*"?([^"#]*?)"?\s*(?:#.*)?$/);
  if (m) cfg[m[1]] = m[2].trim();
}
const KEYWORD = cfg.keyword || "";
const EXPECT = cfg.expect_cdt_ec || "";
const CHD_EXPECT = cfg.expect_chdtp || "";
if (!KEYWORD || !EXPECT || !CHD_EXPECT) {
  console.log(`${ts()} [cdt-rpa] [ERROR] config.yaml rpa_check 缺失 keyword/expect_cdt_ec/expect_chdtp`);
  process.exit(1);
}

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
// 巡查结果摘要行同步进容器监控日志 app.log(与 cdt_rpa.log 并行留存)
async function logApp(msg) {
  const line = `${ts()} [INFO] ${msg}\n`;
  await appendFile(APP_LOG, line, "utf8").catch((e) => console.log(`(app.log 写入失败: ${e})`));
}

await log(`开始 RPA 巡查 cdt-ec + chdtp(ego-browser 真实浏览器) 配置: keyword=${KEYWORD}, expect_cdt_ec=${EXPECT}, expect_chdtp=${CHD_EXPECT}`);
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
    await logApp(`[大唐集团电商] 搜索公告名称=${KEYWORD}, 最新结果: ${found.message_title}, 招标编码: ${found.message_no}, 发布时间: ${found.publish_time}`);
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

// --- 华电 chdtp: 与容器 _chdtp_query 同法,注入 #iframepage4 查询 ---
await log("开始 RPA 巡查 chdtp(华电)");
await page.goto(CHD_URL, { timeout: 60000 });
await page.waitForLoadState("load", { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(3000);
await page.evaluate(
  (src) => { const ifr = document.querySelector("#iframepage4"); if (ifr) ifr.src = src; },
  `/webs/queryWebZbgg.action?zbggType=1&ggbt=${encodeURIComponent(KEYWORD)}`
);
await page.waitForTimeout(5000);
let chdFound = null;
try {
  const rows = await page.evaluate(() => {
    const doc = document.querySelector("#iframepage4")?.contentDocument;
    if (!doc) return [];
    return [...doc.querySelectorAll("tr")]
      .map((tr) => {
        const tds = [...tr.querySelectorAll("td")].map((td) => (td.textContent || "").trim());
        return { title: tds[1] || "", type: tds[2] || "", date: (tds[3] || "").replace(/[\[\]]/g, "") };
      })
      .filter((r) => r.title.length > 8);
  });
  await log(`搜索 ${KEYWORD} 返回 ${rows.length} 条`);
  chdFound = rows.find((r) => r.title.includes(CHD_EXPECT)) || null;
  if (chdFound) {
    await log(`命中${CHD_EXPECT}公告: ${chdFound.title}, 业务类型: ${chdFound.type}, 发布日期: ${chdFound.date}`);
    await logApp(`[华电集团电商] 搜索公告名称=${KEYWORD}, 命中: ${chdFound.title}, 发布日期: ${chdFound.date}`);
  } else {
    await log(`未找到${CHD_EXPECT}, 前3条: ${rows.slice(0, 3).map((r) => r.title).join(" | ") || "(无)"}`);
  }
} catch (e) {
  await log(`chdtp 查询失败: ${e.message || e}`);
}
if (!chdFound) {
  await page.screenshot({ path: "C:/work/ebid/ebid-monitor/data/chd_rpa_fail.png" });
  await log("已截图: C:/work/ebid/ebid-monitor/data/chd_rpa_fail.png");
}

await task.finish({ keep: [] });
if (!found || !chdFound) process.exitCode = 1;
