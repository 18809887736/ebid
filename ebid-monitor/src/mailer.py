import os
import html
import smtplib
import logging
from email.mime.text import MIMEText
from email.header import Header

logger = logging.getLogger("ebid")

def safe_url(url: str) -> str:
    url = (url or "").strip()
    return url if url.startswith(("http://", "https://")) else "#"

def clean_and_escape(raw_text: str, max_len: int = 200) -> str:
    """先 unescape 还原 HTML 实体，截断后再统一 escape，防止切碎实体"""
    plain = html.unescape(raw_text or "").strip()
    if len(plain) > max_len:
        plain = plain[:max_len] + "..."
    return html.escape(plain)

def send_email(subject: str, html_body: str) -> bool:
    receiver = os.getenv("NOTIFY_RECEIVER")
    channels = [
        ("Primary", os.getenv("SMTP_PRIMARY_HOST"), int(os.getenv("SMTP_PRIMARY_PORT", 465)),
         os.getenv("SMTP_PRIMARY_USER"), os.getenv("SMTP_PRIMARY_PASS")),
        ("Backup", os.getenv("SMTP_BACKUP_HOST"), int(os.getenv("SMTP_BACKUP_PORT", 465)),
         os.getenv("SMTP_BACKUP_USER"), os.getenv("SMTP_BACKUP_PASS")),
    ]
    for name, host, port, user, pwd in channels:
        if not (host and user and pwd):
            continue
        try:
            msg = MIMEText(html_body, "html", "utf-8")
            msg["From"] = user
            msg["To"] = receiver
            msg["Subject"] = Header(subject, "utf-8")
            with smtplib.SMTP_SSL(host, port, timeout=20) as server:
                server.login(user, pwd)
                server.sendmail(user, [receiver], msg.as_string())
            logger.info(f"邮件发送成功 [{name}]: {subject}")
            return True
        except Exception as e:
            logger.error(f"邮件通道 [{name}] 发送失败: {e}")
    return False

def render_notices_html(items: list[dict]) -> str:
    rows = []
    for it in items:
        prefix = "<b style='color:#d9534f;'>【截止变更】</b> " if it.get("is_changed") else ""
        title_escaped = clean_and_escape(it["title"], 200)
        site_name = clean_and_escape(it["site_name"], 50)
        ntype = clean_and_escape(it.get("notice_type") or "公告", 30)
        pub_date = clean_and_escape(it.get("pub_date") or "-", 30)
        deadline = clean_and_escape(it.get("deadline") or "-", 30)
        url = html.escape(safe_url(it["url"]), quote=True)
        rows.append(f"""
        <tr>
            <td style="padding:8px;border:1px solid #ddd;">{site_name}</td>
            <td style="padding:8px;border:1px solid #ddd;">{ntype}</td>
            <td style="padding:8px;border:1px solid #ddd;">{prefix}<a href="{url}" target="_blank">{title_escaped}</a></td>
            <td style="padding:8px;border:1px solid #ddd;">{pub_date}</td>
            <td style="padding:8px;border:1px solid #ddd;color:#d9534f;">{deadline}</td>
        </tr>""")
    return f"""
    <h3>发现 {len(items)} 条电力招投标监控命中公告：</h3>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <thead>
            <tr style="background:#f5f5f5;">
                <th style="padding:8px;border:1px solid #ddd;">来源平台</th>
                <th style="padding:8px;border:1px solid #ddd;">类型</th>
                <th style="padding:8px;border:1px solid #ddd;">公告标题</th>
                <th style="padding:8px;border:1px solid #ddd;">发布日期</th>
                <th style="padding:8px;border:1px solid #ddd;">截止时间</th>
            </tr>
        </thead>
        <tbody>{''.join(rows)}</tbody>
    </table>"""
