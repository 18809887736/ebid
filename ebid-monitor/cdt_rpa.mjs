// cdt-ec + chdtp + espic RPA patrol via ego-browser: real Chromium passes 瑞数/盾JS挑战.
// Search keywords come from config.yaml keywords.include (same vocabulary as the monitor).
// Data via in-page POST/injected iframe (UI tables render unreliable under automation).
// espic 有雷池滑块:自动解一次,再留 45s 供人工在 ego 窗口拖动,期间巡查自动继续.
// Per-keyword result lines also append to app.log.
import { appendFile, readFile } from "node:fs/promises";

const LOG = "C:/work/ebid/ebid-monitor/data/cdt_rpa.log";
const APP_LOG = "C:/work/ebid/ebid-monitor/data/app.log";
const CDT_URL = "https://www.cdt-ec.com/notice/moreController/toMore?globleType=0";
const CHD_URL = "https://www.chdtp.com/pages/wzglS/cgxx/caigou.jsp?cgtype=4";
const ESPIC_URL = "https://ebid.espic.com.cn/newgdtcms//category/bulletinListNew.html?dates=300&categoryId=2&tenderMethod=01&tabName=%E6%8B%9B%E6%A0%87%E4%BF%A1%E6%81%AF&page=1";

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

await log(`开始 RPA 巡查 cdt-ec + chdtp(ego-browser 真实浏览器) 关键词来源=config.yaml keywords.include: ${KEYWORDS.join(", ")}`);
const day = ts().slice(0, 10).replaceAll("-", "");
const task = await taskSpace(`cdt-ec-rpa-${day}`);
const page = task.page("p1");
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

// --- 国电投 espic: 雷池盾(盾JS挑战+滑块)。自动解滑块一次,再留 45s 供人工拖动 ---
async function espicState() {
  return page.evaluate(() => {
    const bodyLen = (document.body?.innerText || "").length;
    const doc = document.querySelector("iframe")?.contentDocument;
    const t = doc?.body?.innerText || "";
    if (doc && (t.includes("向右滑动") || doc.querySelector(".slider"))) return "slider";
    if (doc && [...doc.querySelectorAll("input")].some((i) => i.type === "text" && i.offsetParent) && t.length > 80) return "ready";
    return bodyLen > 0 ? "noframe" : "shield";
  });
}
// 缺口定位:块 canvas 梯度模板与背景 canvas 相关匹配,返回滑块把手的页面坐标与拖距
async function solveSlider() {
  const geo = await page.evaluate(() => {
    const ifr = document.querySelector("iframe");
    const fr = ifr.getBoundingClientRect();
    const doc = ifr.contentDocument;
    const bg = [...doc.querySelectorAll("canvas")].find((c) => !c.classList.contains("block"));
    const block = doc.querySelector("canvas.block");
    const slider = doc.querySelector(".slider");
    if (!bg || !block || !slider) return null;
    const snap = (src) => {
      const cp = doc.createElement("canvas");
      cp.width = src.width; cp.height = src.height;
      cp.getContext("2d").drawImage(src, 0, 0);
      return cp.getContext("2d").getImageData(0, 0, cp.width, cp.height);
    };
    const bi = snap(bg), pi = snap(block);
    const BW = bg.width, BH = bg.height, PW = block.width, PH = block.height;
    const bgL = [], pgL = [];
    for (let y = 0; y < BH; y++) { bgL[y] = []; for (let x = 0; x < BW; x++) { const i = (y * BW + x) * 4; bgL[y][x] = 0.299*bi.data[i] + 0.587*bi.data[i+1] + 0.114*bi.data[i+2]; } }
    for (let y = 0; y < PH; y++) { pgL[y] = []; for (let x = 0; x < PW; x++) { const i = (y * PW + x) * 4; pgL[y][x] = pi.data[i+3] > 100 ? 0.299*pi.data[i] + 0.587*pi.data[i+1] + 0.114*pi.data[i+2] : null; } }
    const grad = (L, x, y) => {
      const g = L[y+1]?.[x] - L[y-1]?.[x], h = L[y]?.[x+1] - L[y]?.[x-1];
      if (g == null || h == null) return null;
      return Math.abs(g) + Math.abs(h);
    };
    const scores = [];
    for (let x0 = 10; x0 <= BW - PW; x0++) {
      let s = 0, n = 0;
      for (let py = 2; py < PH - 2; py += 2) for (let px = 2; px < PW - 2; px += 2) {
        if (pgL[py][px] == null) continue;
        const a = grad(pgL, px, py), b = grad(bgL, x0 + px, py);
        if (a == null || b == null) continue;
        s += Math.abs(a - b); n++;
      }
      scores.push({ x: x0, s: n ? Math.round(s / n) : 99999 });
    }
    scores.sort((a, b) => a.s - b.s);
    const sr = slider.getBoundingClientRect();
    return { gap: scores[0].x, startX: Math.round(fr.x + sr.x + sr.width / 2), startY: Math.round(fr.y + sr.y + sr.height / 2) };
  });
  if (!geo) return false;
  await log(`espic 滑块: 缺口 x=${geo.gap}, 把手 (${geo.startX},${geo.startY})`);
  await page.mouse.move(geo.startX, geo.startY);
  await page.mouse.down();
  for (let i = 1; i <= 19; i++) {
    await page.mouse.move(geo.startX + Math.min(geo.gap, i * 10 + Math.floor(Math.random() * 2)), geo.startY + (Math.random() * 3 - 1.5));
    await page.waitForTimeout(20 + Math.floor(Math.random() * 40));
  }
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(6000);
  const st = await espicState();
  if (st === "slider") { await log("espic 自动解滑块未通过"); return false; }
  return true;
}
await log(`打开 espic: ${ESPIC_URL}`);
await page.goto(ESPIC_URL, { timeout: 60000 });
await page.waitForLoadState("load", { timeout: 60000 }).catch(() => {});
let espicOk = false;
for (let i = 0; i < 8 && !espicOk; i++) {
  const st = await espicState();
  if (st === "ready") { espicOk = true; break; }
  if (st === "slider") {
    await log("espic 出现滑块,尝试自动拖动;若失败请在 ego 窗口手动拖一次(45s 内)");
    if (await solveSlider()) { espicOk = true; break; }
    const t0 = Date.now();
    while (Date.now() - t0 < 45000) {
      await page.waitForTimeout(3000);
      const s2 = await espicState();
      if (s2 === "ready") { espicOk = true; await log("espic 滑块已通过(人工或延迟校验)"); break; }
      if (s2 === "slider" && Date.now() - t0 < 15000 && (await solveSlider())) { espicOk = true; break; }
    }
    break;
  }
  await page.waitForTimeout(6000); // shield/noframe: 盾 JS 挑战中,继续等
}
if (!espicOk) {
  failed = true;
  await shot("C:/work/ebid/ebid-monitor/data/espic_rpa_fail.png");
  await log("espic 未能通过验证(截图: C:/work/ebid/ebid-monitor/data/espic_rpa_fail.png),本次跳过其关键词巡查");
} else {
  for (const kw of KEYWORDS) {
    try {
      const rows = await page.evaluate((kw2) => {
        const doc = document.querySelector("iframe")?.contentDocument;
        if (!doc) return [];
        const inp = [...doc.querySelectorAll("input")].find((i) => i.type === "text" && i.offsetParent);
        if (!inp) return null;
        inp.value = kw2;
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        const btn = [...doc.querySelectorAll("button, a, input[type=button]")].find((b) => (b.innerText || b.value || "").includes("搜索"));
        if (!btn) return null;
        btn.click();
        return [];
      }, kw);
      if (rows === null) { await log(`[espic] 关键词=${kw} 未找到搜索控件,跳过该词`); continue; }
      await page.waitForTimeout(6000);
      const items = await page.evaluate(() => {
        const doc = document.querySelector("iframe")?.contentDocument;
        if (!doc) return [];
        const seen = new Set();
        return [...doc.querySelectorAll("tr, li, .list-item, .item, div")]
          .map((el) => {
            const t = (el.innerText || "").replace(/\s+/g, " ").trim();
            const d = (el.innerText || "").match(/\d{4}-\d{2}-\d{2}/);
            return { title: t.slice(0, 200), date: d ? d[0] : "" };
          })
          .filter((r) => {
            if (r.title.length < 12 || /^(招标编号|招标方式|报名截止|发布时间|采购项目信息)/.test(r.title)) return false;
            const k = r.title.slice(0, 40);
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          })
          .slice(0, 20);
      });
      await log(`[espic] 关键词=${kw} 返回 ${items.length} 条`);
      if (items.length) {
        const top = items[0];
        await logApp(`[国电投电能易购] RPA巡查 关键词=${kw}, 返回 ${items.length} 条, 最新: ${top.title}, 发布日期: ${top.date}`);
      }
    } catch (e) {
      failed = true;
      await log(`[espic] 关键词=${kw} 查询失败: ${e.message || e}`);
    }
  }
}

await task.finish({ keep: [] });
if (failed) process.exitCode = 1;
