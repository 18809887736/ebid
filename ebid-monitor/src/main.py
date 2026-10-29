import sys
import time
import yaml
import shutil
import logging
from datetime import datetime
from logging.handlers import RotatingFileHandler
from playwright.sync_api import sync_playwright

from storage import (
    init_db, upsert_notice, get_pending_notices, mark_notified,
    is_slot_done_today, mark_slot_done, is_penetrated, mark_penetrated
)
from mailer import send_email, render_notices_html
from sites import fetch_list, fetch_detail

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        RotatingFileHandler("/app/data/app.log", maxBytes=10*1024*1024, backupCount=5, encoding="utf-8"),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("ebid")

def load_config() -> dict:
    with open("/app/config.yaml", "r", encoding="utf-8") as f:
        return yaml.safe_load(f)

def match_keywords(title: str, kw_cfg: dict) -> bool:
    t_upper = title.upper()
    if any(ex.upper() in t_upper for ex in kw_cfg.get("exclude", [])):
        return False
    return any(inc.upper() in t_upper for inc in kw_cfg.get("include", []))

def is_excluded(title: str, kw_cfg: dict) -> bool:
    t_upper = title.upper()
    return any(ex.upper() in t_upper for ex in kw_cfg.get("exclude", []))

def run_job(send_daily_report: bool = False):
    cfg = load_config()
    init_db()
    stats = []
    has_site_error = False

    logger.info("========== 开始执行招投标巡检轮次 ==========")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--disable-blink-features=AutomationControlled"])
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
        )
        context.set_default_timeout(40000)

        for site_key, site_meta in cfg["sites"].items():
            if not site_meta.get("enabled", False):
                continue

            site_name = site_meta["name"]
            try:
                raw_items = fetch_list(context, site_key)
                raw_count = len(raw_items)
                hit_count = 0
                penetrate_count = 0

                for item in raw_items:
                    if is_excluded(item["title"], cfg["keywords"]):
                        continue
                    item["site"], item["site_name"] = site_key, site_name

                    # 第一级：标题直接命中核心词
                    if match_keywords(item["title"], cfg["keywords"]):
                        if upsert_notice(item):
                            hit_count += 1
                    # 第二级：标题命中批次穿透词 -> 拉取详情正文匹配核心词
                    # (pen_seen 负缓存：未命中条目不再每轮重复拉正文，sgcc 启用后防单轮拖到十几分钟)
                    elif any(pen.upper() in item["title"].upper() for pen in cfg["keywords"].get("batch_penetrate", [])):
                        pkey = item.get("native_id") or item["title"]
                        if not is_penetrated(site_key, pkey):
                            penetrate_count += 1
                            body = fetch_detail(context, site_key, item)
                            mark_penetrated(site_key, pkey)
                            if body and any(k.upper() in body.upper() for k in cfg["keywords"]["include"]):
                                item["title"] = f"[正文命中] {item['title']}"
                                if upsert_notice(item):
                                    hit_count += 1

                status = "✅ 正常" if raw_count > 0 else "⚠️ 抓取为0(疑似改版或空窗)"
                if raw_count == 0:
                    has_site_error = True
                stats.append(
                    f"<li><b>{site_name}</b>: {status} | 扫描 {raw_count} 条 "
                    f"(穿透 {penetrate_count} 条)，新增命中 {hit_count} 条</li>"
                )
                logger.info(f"[{site_name}] 扫描: {raw_count}, 穿透: {penetrate_count}, 新增命中: {hit_count}")
            except Exception as e:
                has_site_error = True
                stats.append(f"<li style='color:red;'><b>{site_name}</b>: ❌ 抓取异常 ({str(e)[:100]})</li>")
                logger.error(f"[{site_name}] 采集失败: {e}", exc_info=True)

        browser.close()

    # 1. 发送待通知的新标/变更公告（含历史未发积压记录）
    pending = get_pending_notices()
    if pending:
        subject = f"【新标提醒】发现 {len(pending)} 条 AVC/AGC 招标公告 ({datetime.now().strftime('%m-%d %H:%M')})"
        if send_email(subject, render_notices_html(pending)):
            mark_notified([it["dedupe_key"] for it in pending])
        else:
            logger.critical("主备邮箱双通道均失败！未发记录保留在库中，等待下一轮自动补发。")

    # 2. 发送每日心跳日报（或当任意启用站点异常时立即告警）
    if send_daily_report or has_site_error:
        free_gb = shutil.disk_usage("/app/data").free // (1024**3)
        prefix = "【⚠️站点异常】" if has_site_error else "【✅巡检日报】"
        report_subj = f"{prefix} 电力招投标监控日报 ({datetime.now().strftime('%Y-%m-%d')})"
        report_html = f"""
        <h3>电力招投标监控系统 — 运行状态汇总</h3>
        <ul>{''.join(stats)}</ul>
        <p style="color:#666;font-size:12px;">数据盘剩余空间: {free_gb} GB | 待补发积压队列: {len(get_pending_notices())} 条</p>
        """
        send_email(report_subj, report_html)

if __name__ == "__main__":
    if "--now" in sys.argv:
        run_job(send_daily_report=True)
        sys.exit(0)

    init_db()
    logger.info("监控守护进程已启动，进入状态槽轮询模式...")
    while True:
        cfg = load_config()
        slots = sorted(cfg["schedule"].get("runs", ["08:30", "14:30"]))
        report_slot = cfg["schedule"].get("daily_report_time", "08:30")
        now = datetime.now()
        today_str = now.strftime("%Y-%m-%d")
        now_hm = now.strftime("%H:%M")

        for slot in slots:
            if now_hm >= slot and not is_slot_done_today(slot, today_str):
                logger.info(f"触发时间槽 [{slot}] (当前时间 {now_hm})...")
                try:
                    run_job(send_daily_report=(slot == report_slot))
                    mark_slot_done(slot, today_str)
                except Exception:
                    # 轮次失败不杀进程、不标记槽位，下个轮询周期自动重试（配置改坏时容器存活可热修）
                    logger.critical(f"时间槽 [{slot}] 执行失败，将在下个轮询周期重试", exc_info=True)

        time.sleep(30)
