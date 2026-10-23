// 每日 AVC/AGC 招标公告检查 - 浏览器部分(华电 chdtp + 犀维 cweme/大唐)
// 用法: ego-browser nodejs < C:\work\bidweb\scripts\check_chd_cweme.mjs
// 输出: C:\work\bidweb\data\browser_results.json
const OUT = "C:/work/bidweb/data/browser_results.json";
const fs = await import("node:fs");

const task = await taskSpace("bidweb-daily-check");
const page = task.page("p1");
const results = [];

// ---------- 华电 chdtp.com ----------
async function checkChd() {
  const out = [];
  try {
    await page.goto("https://www.chdtp.com/pages/wzglS/cgxx/caigou.jsp?cgtype=4", { timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
    for (const kw of ["AVC", "AGC"]) {
      await page.evaluate((k) => {
        const f = document.querySelector("#iframepage4");
        if (f) f.src = "https://www.chdtp.com/webs/queryWebZbgg.action?zbggType=1&ggbt=" + encodeURIComponent(k);
        return !!f;
      }, kw);
      await page.waitForTimeout(4000);
      const rows = await page.evaluate(() => {
        const f = document.querySelector("#iframepage4");
        const doc = f && f.contentDocument;
        if (!doc || !doc.body) return [];
        return [...doc.querySelectorAll("tr")].map((tr) => {
          const cells = [...tr.querySelectorAll("td")].map((td) => (td.textContent || "").trim());
          const a = tr.querySelector("a[onclick]");
          return { status: cells[0] || "", title: cells[1] || "", type: cells[2] || "", date: (cells[3] || "").replace(/[\[\]]/g, ""), link: a ? a.getAttribute("onclick") : "" };
        }).filter((r) => r.title.length > 8);
      });
      for (const r of rows) out.push({ site: "中国华电集团电子商务平台", kw, ...r, link: r.link ? "https://www.chdtp.com/pages/wzglS/cgxx/caigou.jsp?cgtype=4 (" + r.link.slice(0, 120) + ")" : "https://www.chdtp.com/pages/wzglS/cgxx/caigou.jsp?cgtype=4" });
    }
  } catch (e) {
    out.push({ site: "中国华电集团电子商务平台", error: String(e).slice(0, 300) });
  }
  return out;
}

// ---------- 犀维网 cweme.cn(大唐及多集团) ----------
async function checkCweme() {
  const out = [];
  try {
    await page.goto("https://www.cweme.cn/cweme-index/webpage/jsp/zbggList.jsp", { timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const typeNames = { "0": "招标公告", "1": "变更公告", "4": "非招标公告" };
    for (const mt of ["0", "1", "4"]) {
      for (const kw of ["AVC", "AGC"]) {
        const r = await page.fetch("https://www.cweme.cn/cweme-index/indexController/getList", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: `limit=30&page=1&messagetype=${mt}&message_title=${encodeURIComponent(kw)}&bid_tenderer=&message_no=&pro_bidding_mothod=&startDate=&endDate=`,
          timeout: 15000,
        });
        if (r.status !== 200) { out.push({ site: "犀维网(大唐)", error: "HTTP " + r.status + " mt=" + mt }); continue; }
        const j = JSON.parse(r.body);
        for (const g of j.data || []) {
          out.push({
            site: "大唐电子商务平台(犀维网)", kw,
            status: typeNames[mt] || mt,
            title: g.message_title || "",
            type: g.pro_bidding_mothod || "",
            date: (g.publish_time || "").slice(0, 10),
            link: "https://www.cweme.cn/cweme-index/webpage/jsp/" + (mt === "0" || mt === "1" ? "zbggDetail.jsp?id=" + (g.gg_id || g.id) : "fzbggDetail.jsp?id=" + (g.gg_id || g.id)),
            org: g.bid_tenderer || "", no: g.message_no || "", deadline: (g.deadline || "").slice(0, 10),
          });
        }
      }
    }
  } catch (e) {
    out.push({ site: "犀维网(大唐)", error: String(e).slice(0, 300) });
  }
  return out;
}

const chd = await checkChd();
const cweme = await checkCweme();
fs.writeFileSync(OUT, JSON.stringify({ time: new Date().toISOString(), chd, cweme }, null, 1), "utf-8");
console.log("OK chd=" + chd.length + " cweme=" + cweme.length + " -> " + OUT);
try { await task.finish({ keep: [] }); } catch {}
