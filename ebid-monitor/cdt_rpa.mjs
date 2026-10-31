// cdt-ec + chdtp RPA patrol via ego-browser (keywords from config.yaml). espic runs separately on the Linux box (host_cdt_rpa.ps1 stage 2): its SafeLine slider needs real X input (xdotool).
// Search keywords come from config.yaml keywords.include (same vocabulary as the monitor).
// Data via in-page POST/injected iframe (UI tables render unreliable under automation).
// espic 有雷池滑块:自动解一次,再留 45s 供人工在 ego 窗口拖动,期间巡查自动继续.
// Per-keyword result lines also append to app.log.
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const LOG = "C:/work/ebid/ebid-monitor/data/cdt_rpa.log";
const APP_LOG = "C:/work/ebid/ebid-monitor/data/app.log";
const CDT_URL = "https://www.cdt-ec.com/notice/moreController/toMore?globleType=0";
const CHD_URL = "https://www.chdtp.com/pages/wzglS/cgxx/caigou.jsp?cgtype=4";

// espic 的 canvas 渲染会卡死 CDP 截图,15s 未返回即放弃
async function shot(path) {
  const res = await Promise.race([
    page.screenshot({ path }),
    new Promise((res) => setTimeout(() => res("timeout"), 15000)),
  ]);
  if (res === "timeout") await log(`(截图超时,跳过: ${path})`);
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

// 从 config.yaml 解析 keywords.include 列表(仅识别 "引号词" 条目)
const txt = await readFile("C:/work/ebid/ebid-monitor/config.yaml", "utf8");
const lines = txt.split(/\r?\n/);
const kIdx = lines.findIndex((l) => /^keywords:/.test(l));
const iIdx = lines.findIndex((l, i) => i > kIdx && /^\s+include:/.test(l));
const KEYWORDS = [];
for (const l of lines.slice(iIdx + 1)) {
  const m = l.match(/^\s*-\s*"([^"]*)"/);
  if (!m) break;
  KEYWORDS.push(m[1]);
}
if (!KEYWORDS.length) {
  console.log(`${ts()} [cdt-rpa] [ERROR] config.yaml keywords.include 未解析到关键词`);
  process.exit(1);
}
await writeFile("C:/work/ebid/ebid-monitor/data/espic_keywords.txt", KEYWORDS.join(","), "utf8");

await log(`开始 RPA 巡查 cdt-ec + chdtp(ego-browser 真实浏览器) 关键词来源=config.yaml keywords.include: ${KEYWORDS.join(", ")}`);
const day = ts().slice(0, 10).replaceAll("-", "");
const task = await taskSpace(`cdt-ec-rpa-${day}`);
const page = task.page("p1");
const WIN_TITLE = `cdt-ec-rpa-${day}`; // ego 任务页窗口标题 = 任务空间名(OS 拖动器按此找窗)
let failed = false;

// --- 大唐 cdt-ec: 页内 POST getList(与 layui 表格同接口) ---
await log(`打开 cdt-ec: ${CDT_URL}`);
await page.goto(CDT_URL, { timeout: 60000 });
await page.waitForLoadState("load", { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(5000);
for (const kw of KEYWORDS) {
  try {
    const res = await page.fetch("/notice/moreController/getList", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest" },
      body: `page=1&limit=10&messagetype=0&startDate=&endDate=&message_title=${encodeURIComponent(kw)}&purchase_unit=&purchase_unit_agent=&purchase_code=&purchase_type=&message_no=&pro_bidding_mothod=`,
      timeout: 20000,
    });
    const rows = JSON.parse(res.body || "{}").data || [];
    await log(`[cdt-ec] 关键词=${kw} 返回 ${rows.length} 条`);
    if (rows.length) {
      const top = rows[0];
      await logApp(`[大唐集团电商] RPA巡查 关键词=${kw}, 返回 ${rows.length} 条, 最新: ${top.message_title}, 发布时间: ${top.publish_time}`);
    }
  } catch (e) {
    failed = true;
    await log(`[cdt-ec] 关键词=${kw} 查询失败: ${e.message || e}`);
  }
  await page.waitForTimeout(2000);
}
if (failed) {
  await shot("C:/work/ebid/ebid-monitor/data/cdt_rpa_fail.png");
  await log("cdt-ec 有失败项,已截图: C:/work/ebid/ebid-monitor/data/cdt_rpa_fail.png");
}

// --- 华电 chdtp: 注入 #iframepage4 查询(与容器 _chdtp_query 同法) ---
await log(`打开 chdtp: ${CHD_URL}`);
await page.goto(CHD_URL, { timeout: 60000 });
await page.waitForLoadState("load", { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(3000);
for (const kw of KEYWORDS) {
  try {
    await page.evaluate(
      (src) => { const ifr = document.querySelector("#iframepage4"); if (ifr) ifr.src = src; },
      `/webs/queryWebZbgg.action?zbggType=1&ggbt=${encodeURIComponent(kw)}`
    );
    await page.waitForTimeout(5000);
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
    await log(`[chdtp] 关键词=${kw} 返回 ${rows.length} 条`);
    if (rows.length) {
      const top = rows[0];
      await logApp(`[华电集团电商] RPA巡查 关键词=${kw}, 返回 ${rows.length} 条, 最新: ${top.title}, 发布日期: ${top.date}`);
    }
  } catch (e) {
    failed = true;
    await log(`[chdtp] 关键词=${kw} 查询失败: ${e.message || e}`);
  }
}
if (failed) {
  await shot("C:/work/ebid/ebid-monitor/data/chd_rpa_fail.png");
  await log("chdtp 有失败项,已截图: C:/work/ebid/ebid-monitor/data/chd_rpa_fail.png");
}

await task.finish({ keep: [] });
if (failed) process.exitCode = 1;
