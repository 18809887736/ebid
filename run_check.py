# -*- coding: utf-8 -*-
"""每日 AVC/AGC 招标公告检查(编排器)
用法:
  python run_check.py --baseline   # 首次运行:只建档不通知
  python run_check.py              # 日常运行:发现新公告则发邮件到 NOTIFY_TO
站点:
  1. 国能E招 chnenergybidding.com.cn  (urllib 直接抓)
  2. 华电 chdtp.com                   (ego-browser,瑞数反爬)
  3. 大唐/犀维 cweme.cn               (ego-browser,page.fetch API)
"""
import io
import json
import hashlib
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from datetime import date, datetime, timedelta

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
SEEN = os.path.join(DATA, "seen.json")
BROWSER_JSON = os.path.join(DATA, "browser_results.json")
LAST_RUN = os.path.join(DATA, "last_run.json")
BROWSER_MJS = os.path.join(BASE, "scripts", "check_chd_cweme.mjs")
NOTIFY_TO = "1783602@qq.com"
KEYWORD_RE = re.compile(r"AVC|AGC|自动电压控制|自动发电控制", re.I)
FRESH_DAYS = 30          # 只通知 FRESH_DAYS 内发布的
BASELINE_RECENT = 14     # 基线邮件里列最近 N 天的

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"}


def fetch(url, timeout=25):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "ignore")


# ---------------- 国能E招 ----------------
GN_CATS = {"001002": "招标公告", "001003": "非招标公告", "001004": "变更公告"}

def check_guoneng():
    items, errors = [], []
    for cat, catname in GN_CATS.items():
        for page_url in [f"http://www.chnenergybidding.com.cn/bidweb/001/{cat}/moreinfo.html",
                         f"http://www.chnenergybidding.com.cn/bidweb/001/{cat}/2.html",
                         f"http://www.chnenergybidding.com.cn/bidweb/001/{cat}/3.html"]:
            try:
                html = fetch(page_url)
            except Exception as e:
                errors.append(f"国能E招 {catname} {page_url}: {e}")
                continue
            for m in re.finditer(r'href="(/bidweb/001/' + cat + r'/\d+?/(\d{8})/[0-9a-f\-]+\.html)"[^>]*title="([^"]+)"', html):
                path, ymd, title = m.group(1), m.group(2), m.group(3)
                if not KEYWORD_RE.search(title):
                    continue
                d = f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:]}" if len(ymd) == 8 else ""
                items.append({"site": "国能E招", "type": catname, "status": "", "title": title,
                              "date": d, "link": "http://www.chnenergybidding.com.cn" + path})
    return items, errors


# ---------------- 浏览器站(华电+犀维) ----------------
def check_browser():
    if os.path.exists(BROWSER_JSON):
        os.remove(BROWSER_JSON)
    try:
        p = subprocess.run(["ego-browser", "nodejs"], stdin=open(BROWSER_MJS, "rb"),
                           capture_output=True, timeout=300)
        out = (p.stdout or b"") + (p.stderr or b"")
        text = out.decode("utf-8", "replace")
    except Exception as e:
        return [], [f"ego-browser 运行失败: {e}"]
    if not os.path.exists(BROWSER_JSON):
        return [], [f"ego-browser 未产出结果: {text[-500:]}"]
    j = json.load(open(BROWSER_JSON, encoding="utf-8"))
    items, errors = [], []
    for row in j.get("chd", []) + j.get("cweme", []):
        if "error" in row:
            errors.append(f"{row.get('site')}: {row['error']}")
            continue
        # 浏览器站结果来自站内关键词搜索,标题可能被"..."截断,不再本地过滤
        items.append({"site": row["site"], "type": row.get("type", ""), "status": row.get("status", ""),
                      "title": row["title"], "date": row.get("date", ""), "link": row.get("link", ""),
                      "org": row.get("org", ""), "no": row.get("no", ""), "deadline": row.get("deadline", "")})
    return items, errors


# ---------------- 去重与通知 ----------------
def item_key(it):
    return hashlib.md5((it["site"] + "|" + it["title"]).encode("utf-8")).hexdigest()

def load_seen():
    return json.load(open(SEEN, encoding="utf-8")) if os.path.exists(SEEN) else {}

def save_seen(seen):
    json.dump(seen, open(SEEN, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

def html_escape(s):
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def build_email(new_items, errors, baseline_recent):
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    rows = ""
    for it in new_items:
        link = it.get("link") or ""
        title = html_escape(it["title"])
        t = f'<a href="{html_escape(link)}">{title}</a>' if link.startswith("http") else title
        extra = " ".join(f"{k}:{html_escape(it[k])}" for k in ("org", "no", "deadline") if it.get(k))
        rows += (f"<tr><td nowrap>{html_escape(it['date'])}</td><td nowrap>{html_escape(it['site'])}<br>"
                 f"{html_escape(it.get('status') or it.get('type') or '')}</td><td>{t}<br><small>{extra}</small></td></tr>")
    err = ""
    if errors:
        err = "<p><b>检查告警:</b><br>" + "<br>".join(html_escape(e) for e in errors) + "</p>"
    body = (f"<h3>AVC/AGC 招标公告监控 ({html_escape(now)})</h3>"
            f"<p>本次新发现 <b>{len(new_items)}</b> 条:</p>"
            f'<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px">'
            f"<tr><th>日期</th><th>站点</th><th>公告</th></tr>{rows}</table>{err}"
            f"<p style='color:#888'>监控范围: 国能E招 / 华电 / 大唐(犀维网) · 关键词: AVC、AGC、自动电压控制、自动发电控制 · 每日 08:30 / 14:30 自动检查</p>")
    subject = f"【招标监控】发现 {len(new_items)} 条 AVC/AGC 相关公告 {datetime.now().strftime('%m-%d %H:%M')}"
    return subject, body

def send_email(subject, body):
    import shutil
    cli = shutil.which("agently-cli") or "agently-cli"
    body_file = os.path.join(DATA, "mail_body.html")
    io.open(body_file, "w", encoding="utf-8").write(body)
    base = [cli, "message", "+send", "--to", NOTIFY_TO, "--subject", subject, "--body-file", "data/mail_body.html"]
    p1 = subprocess.run(base, capture_output=True, timeout=60, cwd=BASE)
    t1 = ((p1.stdout or b"") + (p1.stderr or b"")).decode("utf-8", "replace")
    m = re.search(r"ctk_[A-Za-z0-9_\-]+", t1)
    if not m:
        return False, t1[-400:]
    p2 = subprocess.run(base + ["--confirmation-token", m.group(0)], capture_output=True, timeout=60, cwd=BASE)
    t2 = ((p2.stdout or b"") + (p2.stderr or b"")).decode("utf-8", "replace")
    return '"ok": true' in t2.lower() or '"ok":true' in t2.lower(), t2[-400:]


def main():
    baseline = "--baseline" in sys.argv
    no_email = "--no-email" in sys.argv
    os.makedirs(DATA, exist_ok=True)

    gn_items, gn_err = check_guoneng()
    br_items, br_err = check_browser()
    all_items = gn_items + br_items
    errors = gn_err + br_err

    # 按 site+title 去重(同一条可能 AVC/AGC 都命中)
    uniq = {}
    for it in all_items:
        uniq.setdefault(item_key(it), it)
    items = list(uniq.values())

    seen = load_seen()
    new_items = [it for it in items if item_key(it) not in seen]
    today = date.today()
    fresh_new = [it for it in new_items
                 if not it["date"] or (today - date.fromisoformat(it["date"])).days <= FRESH_DAYS]
    for it in new_items:
        seen[item_key(it)] = {"first_seen": datetime.now().isoformat(timespec="seconds"),
                              "title": it["title"], "site": it["site"], "date": it["date"]}
    save_seen(seen)

    mail_status = "未发送"
    if baseline:
        recent = [it for it in items
                  if it["date"] and (today - date.fromisoformat(it["date"])).days <= BASELINE_RECENT]
        subject, body = build_email(recent, errors, BASELINE_RECENT)
        subject = f"【招标监控】已启动 · 近{BASELINE_RECENT}天 AVC/AGC 在发公告 {len(recent)} 条"
        if not no_email and recent:
            ok, info = send_email(subject, body)
            mail_status = "基线邮件已发送" if ok else f"基线邮件失败: {info}"
        else:
            mail_status = f"基线建档 {len(items)} 条,未发邮件"
    elif fresh_new:
        subject, body = build_email(fresh_new, errors, BASELINE_RECENT)
        if not no_email:
            ok, info = send_email(subject, body)
            mail_status = "通知邮件已发送" if ok else f"邮件失败: {info}"
        else:
            mail_status = "--no-email,跳过"
    else:
        mail_status = "无新公告,未发邮件"

    summary = {
        "run_at": datetime.now().isoformat(timespec="seconds"),
        "baseline": baseline,
        "guoneng_items": len(gn_items), "browser_items": len(br_items),
        "total_items": len(items), "new_items": len(new_items), "fresh_new": len(fresh_new),
        "errors": errors, "mail": mail_status,
        "new_titles": [{"site": i["site"], "date": i["date"], "title": i["title"]} for i in fresh_new],
    }
    json.dump(summary, open(LAST_RUN, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    print(f"== 检查完成 {summary['run_at']} ==")
    print(f"国能E招 {len(gn_items)} 条 / 浏览器站 {len(br_items)} 条 / 合计去重 {len(items)} 条")
    print(f"新增 {len(new_items)} 条,其中 {len(fresh_new)} 条在 {FRESH_DAYS} 天内")
    for i in fresh_new:
        print(f"  [新] {i['date']} {i['site']} {i['title'][:60]}")
    for e in errors:
        print(f"  [警告] {e}")
    print(f"邮件: {mail_status}")
    if errors and not fresh_new and not baseline:
        print("RESULT: WARN(有站点检查失败,无新公告)")
    elif fresh_new:
        print("RESULT: FOUND")
    else:
        print("RESULT: CLEAN")


if __name__ == "__main__":
    main()
