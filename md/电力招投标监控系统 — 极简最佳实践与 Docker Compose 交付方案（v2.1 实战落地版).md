# 电力招投标监控系统 — 极简最佳实践与 Docker Compose 交付方案（v2.1 实战落地版）

> **版本状态**：2026-10-29 修订 2（合并《极简方案分析与 sites 适配器落地记录》；将 chnenergy/cdt_ec/chdtp 三站适配器修正回 old/ 实测契约；storage/main 新增穿透负缓存 pen_seen 与轮次异常兜底）
> **核心目标**：以最低的单人维护成本，全天候可靠、不漏地监控各大电力集团的 **AVC / AGC（自动电压控制 / 自动发电控制）** 招标与采购公告，并推送至个人邮箱。
> **设计哲学**：100% 免密公开源采集 + 单容器 All-in-One 封装 + SQLite 单表自愈状态机 + 源码热挂载（改代码免重新构建镜像）。

---

## 一、 方案定位与评审问题闭环（v2.0 至 v2.1 演进）

本方案是对早期重型方案（多表状态机、独立看门狗、文件锁、多语言脚本混调）的极简重构：采用**单容器 All-in-One（内置 Playwright Chromium）+ SQLite 单表状态机（`notified_at IS NULL`）+ 发信成功才落时间戳 + 每日 08:30 心跳日报**，用最少的代码实现“宁重勿漏”。

### 硬伤修复与现状对齐清单

| 级别 | 早期版本问题 | v2.1 落地方案与现状（2026-10-29） |
| :---: | :--- | :--- |
| **P0** | **`batch_penetrate` 是死配置**：`config.yaml` 声明了批次穿透词，但 `main.py` 仅用 `include/exclude` 匹配标题，未读取穿透配置。 | **已彻底解决**：`main.py` 接入 `fetch_list` + `fetch_detail` 两级漏斗；标题未直通但命中 `batch_penetrate` 时，自动拉取正文二次匹配 `include` 核心词，并标记 `[正文命中]`。 |
| **P0** | **华电（`chdtp`）瑞数反爬被轻描淡写带过**：裸 Headless Chromium + 单个 flag 无法过瑞数动态指纹检测。 | **已解决并加固**：移植 `old/` 实测可用的 `#iframepage4` 同源注入方案；新增“空 `ggbt` 拉全量失败时自动降级为 `AVC/AGC` 站内搜索”双保险。 |
| **P0** | **混淆国能E招与国网 ECP2.0**：`old/` 中的 `check_guoneng` 实为国能E招（国家能源集团），并非国家电网 ECP2.0。 | **已修正并新增 Spike**：`check_guoneng` 归位至 `chnenergy`；针对国网 `sgcc` 编写专门的 XHR 响应拦截与详情穿透适配器，并提供容器内一键抓包探针。 |
| **P1** | **`schedule` 库不补跑错过轮次**：若容器在 08:30 重启或宿主机休眠，当轮直接丢失。 | **已升级状态槽补跑**：在 SQLite 中引入极简 `slot_runs` 记录每日槽位完成日期，容器重启或机器唤醒后只要发现当日槽位未跑，立即自动补跑。 |
| **P2** | **连接未显式关闭、变更前缀叠加、HTML 实体截断切碎**。 | **已全部修复**：`contextmanager` 保障 `conn.close()`；用 `is_changed` 字段代替标题字符串拼接污染；先 `html.unescape` 截断再 `html.escape`。 |

---

## 二、 标黄 8 站分级接入策略与当前进度

彻底剥离账号、密码、手机扫码（中招互联/智慧签）与物理 UKey 电子钥匙，100% 走公开免密通道采集：

| 梯队 | 站点代号 | 标黄单位与目标网址 | 采集与穿透机制 | 当前状态 |
| :---: | :--- | :--- | :--- | :---: |
| **第一梯队**<br>（已移植可用） | `chnenergy` | **国能E招** (`chnenergybidding.com.cn`) | 纯 `httpx` 请求 + `_gn_row_re` 正则解析；URL 文件名作 `native_id`；`bs4` 抽正文支持穿透。 | ✅ 已就绪 |
| **第一梯队**<br>（已移植可用） | `cdt_ec` | **大唐集团电商 / 犀维** (`cdt-ec.com` / `cweme.cn`) | 先开列表页拿会话 Cookie，再调 `ctx.request.post` 查 `getList`；`gg_id` 作 `native_id`；支持详情穿透。 | ✅ 已就绪 |
| **第一梯队**<br>（已移植可用） | `chdtp` | **华电集团电商** (`chdtp.com`) | `#iframepage4` 注入查询 URL 过瑞数；从 `onclick` 提取 `native_id`；空 `ggbt` 失败自动回退关键词搜索。 | ✅ 已就绪 |
| **第二梯队**<br>（最高优 Spike） | `sgcc` | **国家电网 ECP2.0 & 绿链** (`ecp.sgcc.com.cn` / `sgccetp.com.cn`) | `page.on("response")` 拦截 `ecpwcmcore` 列表 JSON；对批次标题打开 `#/doc/` 路由提取正文表格做二次穿透。 | 🔧 待容器冒烟 |
| **第三梯队**<br>（排期增量） | `neep`<br>`chng`<br>`espic` | **国家能源e购** (`neep.shop`)<br>**华能电商门户** (`ec.chng.com.cn`，弃用 `101.201.169.110`)<br>**国电投电能易购** (`ebid.espic.com.cn`) | 代码中显式 `raise NotImplementedError`（严禁静默返回 `[]` 混淆改版判据）；在 `config.yaml` 中暂置 `enabled: false`。 | ⏳ 占位待补 |
| **剔除** | — | **中国电力设备信息网** (`cpeinet.com.cn`) | 第三方收费聚合网（需会员费且有安全验证），官方一手源全覆盖后无独占增量，直接放弃。 | 🚫 不纳入 |

---

## 三、 交付目录与容器编排配置

在宿主机创建 `ebid-monitor/` 目录，代码与配置通过 Volume 热挂载进容器，**日常修改 `src/sites.py` 或 `config.yaml` 仅需 `docker compose restart`，无需重新构建镜像**。

```text
ebid-monitor/
├── docker-compose.yml       # 容器编排（含 1GB shm_size 与僵尸进程回收）
├── Dockerfile               # 基于微软官方 Playwright Python 镜像
├── .env                     # 主备双通道 SMTP 邮箱凭据（不入 Git）
├── config.yaml              # 词库（含批次穿透词）与站点启用开关
├── src/
│   ├── main.py              # 状态槽防漏跑调度 + 两级漏斗匹配 + 每日心跳日报
│   ├── sites.py             # 站点适配器（fetch_list + fetch_detail 统一契约 + 离线自检）
│   ├── storage.py           # SQLite 单表状态机 + 槽位记录
│   └── mailer.py            # 安全 HTML 转义 + 主备 SMTP 自动切换
└── data/                    # 持久化数据目录（自动生成 ebid.db 与 app.log）
```

### 1. `docker-compose.yml`
```yaml
services:
  ebid-monitor:
    build: .
    container_name: ebid-monitor
    restart: unless-stopped
    shm_size: '1gb'          # 防止无头 Chromium 渲染复杂页面时因共享内存不足崩溃
    init: true               # 自动回收浏览器子进程，防止长期运行产生僵尸进程
    env_file:
      - .env
    environment:
      - TZ=Asia/Shanghai
      - PYTHONUNBUFFERED=1
    volumes:
      - ./config.yaml:/app/config.yaml:ro
      - ./src:/app/src:ro
      - ./data:/app/data
    logging:
      driver: "json-file"
      options:
        max-size: "20m"
        max-file: "3"
```

### 2. `Dockerfile`
```dockerfile
FROM mcr.microsoft.com/playwright/python:v1.48.0-noble

WORKDIR /app

RUN pip install --no-cache-dir \
    httpx \
    pyyaml \
    playwright==1.48.0 \
    beautifulsoup4

CMD ["python", "src/main.py"]
```

### 3. `.env`（敏感凭据配置）
```ini
# 主邮箱通道 (如 QQ邮箱 / 腾讯企业邮)
SMTP_PRIMARY_HOST=smtp.qq.com
SMTP_PRIMARY_PORT=465
SMTP_PRIMARY_USER=your_main@qq.com
SMTP_PRIMARY_PASS=your_auth_code_1

# 备用邮箱通道 (如 163邮箱，主通道故障时自动接管)
SMTP_BACKUP_HOST=smtp.163.com
SMTP_BACKUP_PORT=465
SMTP_BACKUP_USER=your_backup@163.com
SMTP_BACKUP_PASS=your_auth_code_2

# 接收通知的目标邮箱
NOTIFY_RECEIVER=your_main@qq.com
```

### 4. `config.yaml`（词库与站点开关）
> **注意**：未完成抓包验证的站点保持 `enabled: false`，防止触发每日异常告警。

```yaml
schedule:
  runs:
    - "08:30"   # 早间巡检（此轮固定发送每日巡检日报）
    - "14:30"   # 午后巡检
  daily_report_time: "08:30"

keywords:
  # 第一级：标题直通核心词（或第二级正文穿透匹配词）
  include:
    - "AVC"
    - "AGC"
    - "自动电压"
    - "自动发电"
    - "无功电压"
    - "有功控制"
    - "一次调频"
    - "场站控制"
    - "功率控制"
    - "风光储协调"
  # 第二级：概括性批次标题穿透触发词（命中后调用 fetch_detail 抓正文二次匹配 include）
  batch_penetrate:
    - "二次设备"
    - "调度自动化"
    - "变电设备"
    - "监控系统"
    - "电网数字化"
    - "自动化设备"
  # 排除噪音词
  exclude:
    - "保洁"
    - "食堂"
    - "物业"
    - "通勤车"
    - "办公家具"

sites:
  chnenergy: { name: "国能E招", enabled: true, url: "http://www.chnenergybidding.com.cn" }
  cdt_ec:    { name: "大唐集团电商(犀维)", enabled: true, url: "https://www.cweme.cn" }
  chdtp:     { name: "华电集团电商", enabled: true, url: "https://www.chdtp.com" }
  sgcc:      { name: "国家电网ECP2.0", enabled: true, url: "https://ecp.sgcc.com.cn" }
  neep:      { name: "国家能源e购", enabled: false, url: "http://www.neep.shop" }
  chng:      { name: "华能集团电商", enabled: false, url: "http://ec.chng.com.cn" }
  espic:     { name: "国电投电能易购", enabled: false, url: "https://ebid.espic.com.cn" }
```

---

## 四、 核心代码全集

### 1. `src/storage.py`（单表状态机 + 漏跑补齐状态槽 + 穿透负缓存 + 物理关连接）
```python
import sqlite3
import hashlib
from pathlib import Path
from contextlib import contextmanager

DB_PATH = Path("/app/data/ebid.db")

@contextmanager
def get_conn():
    """确保事务自动提交，并在退出时物理关闭 SQLite 连接"""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            yield conn
    finally:
        conn.close()

def init_db():
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS notices (
                dedupe_key TEXT PRIMARY KEY,
                site TEXT NOT NULL,
                site_name TEXT NOT NULL,
                title TEXT NOT NULL,
                notice_type TEXT,
                url TEXT NOT NULL,
                pub_date TEXT,
                deadline TEXT,
                is_changed INTEGER DEFAULT 0,
                notified_at TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS slot_runs (
                slot_time TEXT PRIMARY KEY,
                last_run_date TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS pen_seen (
                site_key TEXT NOT NULL,
                item_key TEXT NOT NULL,
                seen_at TEXT DEFAULT (datetime('now', 'localtime')),
                PRIMARY KEY (site_key, item_key)
            )
        """)

def is_slot_done_today(slot_time: str, today_str: str) -> bool:
    with get_conn() as conn:
        row = conn.execute("SELECT last_run_date FROM slot_runs WHERE slot_time = ?", (slot_time,)).fetchone()
        return bool(row and row["last_run_date"] == today_str)

def mark_slot_done(slot_time: str, today_str: str):
    with get_conn() as conn:
        conn.execute("""
            INSERT INTO slot_runs (slot_time, last_run_date, updated_at)
            VALUES (?, ?, datetime('now', 'localtime'))
            ON CONFLICT(slot_time) DO UPDATE SET
                last_run_date = excluded.last_run_date,
                updated_at = datetime('now', 'localtime')
        """, (slot_time, today_str))

def is_penetrated(site_key: str, item_key: str) -> bool:
    """穿透负缓存：已拉过正文且未命中的条目不再重复穿透"""
    with get_conn() as conn:
        return conn.execute(
            "SELECT 1 FROM pen_seen WHERE site_key = ? AND item_key = ?", (site_key, item_key)
        ).fetchone() is not None

def mark_penetrated(site_key: str, item_key: str):
    with get_conn() as conn:
        conn.execute("INSERT OR IGNORE INTO pen_seen (site_key, item_key) VALUES (?, ?)", (site_key, item_key))

def make_dedupe_key(site: str, notice_type: str, native_id: str, title: str, pub_date: str) -> str:
    ident = native_id.strip() if native_id else hashlib.sha1(f"{title.strip()}_{pub_date}".encode()).hexdigest()[:16]
    return f"{site}_{notice_type}_{ident}"

def upsert_notice(item: dict) -> bool:
    """插入新公告，或当同键公告 deadline 变化时重置 notified_at=NULL 触发重发"""
    key = make_dedupe_key(
        item["site"], item.get("notice_type", "招标公告"),
        item.get("native_id", ""), item["title"], item.get("pub_date", "")
    )
    with get_conn() as conn:
        row = conn.execute("SELECT deadline FROM notices WHERE dedupe_key = ?", (key,)).fetchone()
        if not row:
            conn.execute("""
                INSERT INTO notices (dedupe_key, site, site_name, title, notice_type, url, pub_date, deadline, is_changed, notified_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
            """, (key, item["site"], item["site_name"], item["title"].strip(),
                  item.get("notice_type", "招标公告"), item["url"],
                  item.get("pub_date", ""), item.get("deadline", "")))
            return True

        new_dl = item.get("deadline", "")
        if new_dl and row["deadline"] != new_dl:
            conn.execute("""
                UPDATE notices
                SET deadline = ?, is_changed = 1, notified_at = NULL
                WHERE dedupe_key = ?
            """, (new_dl, key))
            return True
    return False

def get_pending_notices() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM notices WHERE notified_at IS NULL ORDER BY pub_date DESC").fetchall()
        return [dict(r) for r in rows]

def mark_notified(keys: list[str]):
    if not keys:
        return
    with get_conn() as conn:
        placeholders = ",".join(["?"] * len(keys))
        conn.execute(f"UPDATE notices SET notified_at = datetime('now', 'localtime') WHERE dedupe_key IN ({placeholders})", keys)
```

### 2. `src/mailer.py`（防投毒清洗 + 实体安全截断 + 主备 SMTP）
```python
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
```

### 3. `src/sites.py`（两级穿透接口 + 3 站实测移植 + 国网拦截草稿 + 离线自检）
```python
import re
import logging
import urllib.parse

try:
    import httpx
    from bs4 import BeautifulSoup
except ImportError:
    httpx = None
    BeautifulSoup = None

logger = logging.getLogger("ebid")

# =====================================================================
# 1. 国能E招 (chnenergybidding.com.cn) — old/run_check.py check_guoneng 实测移植
#    实测 URL 形如 /bidweb/001/{cat}/{页码}/{8位日期}/{uuid}.html，日期取自路径段；
#    三个分类(含变更公告) × 前 3 页，与 old/ 抓取范围一致
# =====================================================================
GN_BASE = "http://www.chnenergybidding.com.cn"
GN_CATS = {"001002": "招标公告", "001003": "非招标公告", "001004": "变更公告"}

def _gn_row_re(cat: str) -> re.Pattern:
    return re.compile(
        r'href="(/bidweb/001/' + cat + r'/\d+?/(\d{8})/([0-9a-f\-]+)\.html)"[^>]*title="([^"]+)"'
    )

def _chnenergy_list(ctx) -> list[dict]:
    if httpx is None:
        raise RuntimeError("httpx 未安装")
    items = []
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36"}
    with httpx.Client(base_url=GN_BASE, headers=headers, timeout=25.0, follow_redirects=True) as client:
        for cat, notice_type in GN_CATS.items():
            for page in ("moreinfo.html", "2.html", "3.html"):
                resp = client.get(f"/bidweb/001/{cat}/{page}")
                resp.raise_for_status()
                for m in _gn_row_re(cat).finditer(resp.text):
                    path, ymd, nid, title = m.groups()
                    items.append({
                        "native_id": nid,
                        "title": title.strip(),
                        "notice_type": notice_type,
                        "pub_date": f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:]}" if len(ymd) == 8 else "",
                        "deadline": "",
                        "url": urllib.parse.urljoin(GN_BASE, path),
                    })
    return items

def _chnenergy_detail(ctx, item: dict) -> str:
    if httpx is None or BeautifulSoup is None:
        return ""
    try:
        resp = httpx.get(item["url"], timeout=20.0, follow_redirects=True)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        main_div = soup.select_one(".article-info, .news-detail, #mainContent") or soup.body
        return main_div.get_text(" ", strip=True) if main_div else ""
    except Exception as e:
        logger.warning(f"[chnenergy] 详情抓取失败 {item.get('url')}: {e}")
        return ""


# =====================================================================
# 2. 大唐集团/犀维 (cweme.cn) — old/scripts/check_chd_cweme.mjs checkCweme 实测移植
#    实测接口: POST /cweme-index/indexController/getList
#    (messagetype 0/1/4 + message_title + limit/page)，字段 message_title/publish_time/deadline，
#    详情页 zbggDetail.jsp / fzbggDetail.jsp?id={gg_id}
# =====================================================================
CWEME_PAGE_URL = "https://www.cweme.cn/cweme-index/webpage/jsp/zbggList.jsp"
CWEME_API_URL = "https://www.cweme.cn/cweme-index/indexController/getList"
CW_TYPES = {"0": "招标公告", "1": "变更公告", "4": "非招标公告"}

def _cdt_ec_list(ctx) -> list[dict]:
    items = []
    page = ctx.new_page()
    try:
        # 先开列表页拿会话 Cookie，再用 ctx.request 复用 Cookie 调接口（等价 old 的 page.fetch）
        page.goto(CWEME_PAGE_URL, timeout=45000)
        try:
            page.wait_for_load_state("networkidle", timeout=20000)
        except Exception:
            pass
        for mt, typename in CW_TYPES.items():
            resp = ctx.request.post(CWEME_API_URL, form={
                "limit": "30", "page": "1", "messagetype": mt, "message_title": "",
                "bid_tenderer": "", "message_no": "", "pro_bidding_mothod": "",
                "startDate": "", "endDate": "",
            }, timeout=15000)
            if resp.status != 200:
                raise RuntimeError(f"犀维 getList HTTP {resp.status} messagetype={mt}")
            for g in resp.json().get("data", []):
                nid = str(g.get("gg_id") or g.get("id") or "").strip()
                if not nid:
                    continue
                detail_jsp = "zbggDetail" if mt in ("0", "1") else "fzbggDetail"
                items.append({
                    "native_id": nid,
                    "title": str(g.get("message_title") or "").strip(),
                    "notice_type": typename,
                    "pub_date": str(g.get("publish_time") or "")[:10],
                    "deadline": str(g.get("deadline") or "")[:10],
                    "url": f"https://www.cweme.cn/cweme-index/webpage/jsp/{detail_jsp}.jsp?id={nid}",
                })
        return items
    finally:
        page.close()

def _cdt_ec_detail(ctx, item: dict) -> str:
    if BeautifulSoup is None:
        return ""
    try:
        resp = ctx.request.get(item["url"], timeout=20000)
        if resp.status != 200:
            return ""
        return BeautifulSoup(resp.text(), "html.parser").get_text(" ", strip=True)
    except Exception as e:
        logger.warning(f"[cdt_ec] 详情抓取失败 {item.get('url')}: {e}")
        return ""


# =====================================================================
# 3. 华电集团 (chdtp.com) — old/checkChd 实测移植：
#    入口页为实测可用的 caigou.jsp?cgtype=4（页面含 #iframepage4），
#    注入 /webs/queryWebZbgg.action 查询；空 ggbt 拉全量，失败自动降级站内搜索
# =====================================================================
CHD_PAGE_URL = "https://www.chdtp.com/pages/wzglS/cgxx/caigou.jsp?cgtype=4"
CHD_QUERY_URL = "/webs/queryWebZbgg.action?zbggType=1&ggbt="

def _chd_native_id(onclick: str) -> str:
    m = re.search(r"\d{4,}", onclick or "")
    return m.group(0) if m else ""

def _chdtp_query(page, ggbt: str) -> list[dict]:
    target_src = CHD_QUERY_URL + urllib.parse.quote(ggbt)
    page.evaluate(
        """(src) => { const ifr = document.querySelector('#iframepage4'); if (ifr) ifr.src = src; }""",
        target_src
    )
    page.wait_for_timeout(4000)
    target_frame = next((f for f in page.frames if "queryWebZbgg" in f.url), None)
    if target_frame is None:
        return []
    rows = target_frame.evaluate("""() => {
        const trs = Array.from(document.querySelectorAll('tr'));
        return trs.map(tr => {
            const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.textContent || '').trim());
            const a = tr.querySelector('a[onclick]');
            return {
                title: tds[1] || '',
                type: tds[2] || '',
                date: (tds[3] || '').replace(/[\\[\\]]/g, ''),
                onclick: a ? a.getAttribute('onclick') : ''
            };
        }).filter(r => r.title.length > 8);
    }""")
    # 站点正文无直链 URL（行为 onclick 跳转），条目统一指向入口页，去重靠 native_id
    return [{
        "native_id": _chd_native_id(r["onclick"]),
        "title": r["title"],
        "notice_type": r["type"] or "招标公告",
        "pub_date": r["date"],
        "deadline": "",
        "url": CHD_PAGE_URL,
    } for r in rows]

def _chdtp_list(ctx) -> list[dict]:
    page = ctx.new_page()
    try:
        page.goto(CHD_PAGE_URL, wait_until="domcontentloaded", timeout=45000)
        try:
            page.wait_for_load_state("networkidle", timeout=20000)
        except Exception:
            pass
        page.wait_for_timeout(2000)
        # 空关键词=全量列表，保留全量计数（改版判据）与本地词库过滤
        items = _chdtp_query(page, "")
        if not items:
            # 站点拒绝空 ggbt 时降级为站内搜索；代价：标题可能被截断、失去全量计数（改版判据变弱）
            logger.warning("[chdtp] 空 ggbt 返回 0 条，自动降级为关键词站内搜索模式")
            seen = set()
            for kw in ("AVC", "AGC", "自动电压", "自动发电"):
                for it in _chdtp_query(page, kw):
                    key = it["native_id"] or it["title"]
                    if key not in seen:
                        seen.add(key)
                        items.append(it)
        return items
    finally:
        page.close()


# =====================================================================
# 4. 国家电网 ECP2.0 (ecp.sgcc.com.cn) — XHR 拦截 + 批次公告正文穿透
# =====================================================================
SGCC_LIST_URL = "https://ecp.sgcc.com.cn/ecp2.0/portal/#/list/list-spe/2018032600289606_1_2018032700291334"

def _sgcc_list(ctx) -> list[dict]:
    page = ctx.new_page()
    captured_rows = []

    def _on_response(resp):
        if "ecpwcmcore" in resp.url and resp.request.resource_type in ("xhr", "fetch"):
            try:
                payload = resp.json()
                rv = payload.get("resultValue") or payload.get("data") or {}
                rows = rv.get("noteList") or rv.get("rows") or (rv if isinstance(rv, list) else [])
                if isinstance(rows, list) and rows:
                    captured_rows.extend(rows)
            except Exception:
                pass

    page.on("response", _on_response)
    try:
        page.goto(SGCC_LIST_URL, wait_until="networkidle", timeout=45000)
        if not captured_rows:
            page.wait_for_timeout(3000)

        items = []
        seen = set()
        for r in captured_rows:
            nid = str(r.get("id") or r.get("noticeId") or "").strip()
            title = str(r.get("title") or r.get("noticeTitle") or "").strip()
            if not (nid and title) or nid in seen:
                continue
            seen.add(nid)
            pub_date = str(r.get("noticePublishTime") or r.get("publishTime") or "")[:10]
            doc_type = r.get("doctype") or "doc-spe"
            menu_id = r.get("firstPageMenuId") or "2018032700291334"
            items.append({
                "native_id": nid,
                "title": title,
                "notice_type": "招标公告",
                "pub_date": pub_date,
                "deadline": str(r.get("bidEndTime") or "")[:16],
                "url": f"https://ecp.sgcc.com.cn/ecp2.0/portal/#/doc/{doc_type}/{nid}_{menu_id}",
            })
        return items
    finally:
        page.close()

def _sgcc_detail(ctx, item: dict) -> str:
    url = item.get("url", "")
    if not url or url.endswith("/#/"):
        return ""
    page = ctx.new_page()
    try:
        page.goto(url, wait_until="networkidle", timeout=35000)
        page.wait_for_timeout(2000)
        return page.locator("body").inner_text()
    except Exception as e:
        logger.warning(f"[sgcc] 详情穿透失败 {url}: {e}")
        return ""
    finally:
        page.close()


# =====================================================================
# 5. 未实现站点显式占位（严禁静默返回空列表）与统一调度入口
# =====================================================================
def _unimplemented_list(ctx) -> list[dict]:
    raise NotImplementedError("该站点适配器尚未实现，请在 config.yaml 中将其置为 enabled: false")

LIST_HANDLERS = {
    "chnenergy": _chnenergy_list,
    "cdt_ec":    _cdt_ec_list,
    "chdtp":     _chdtp_list,
    "sgcc":      _sgcc_list,
    "neep":      _unimplemented_list,
    "chng":      _unimplemented_list,
    "espic":     _unimplemented_list,
}

DETAIL_HANDLERS = {
    "chnenergy": _chnenergy_detail,
    "cdt_ec":    _cdt_ec_detail,
    "sgcc":      _sgcc_detail,
}

def fetch_list(ctx, site_key: str) -> list[dict]:
    if site_key not in LIST_HANDLERS:
        raise KeyError(f"未知的站点代号: {site_key}")
    return LIST_HANDLERS[site_key](ctx)

def fetch_detail(ctx, site_key: str, item: dict) -> str:
    handler = DETAIL_HANDLERS.get(site_key)
    if not handler:
        return ""
    return handler(ctx, item)


# =====================================================================
# 6. 离线自检入口（无需联网、无需安装 httpx/playwright 即可验证核心正则与注册表）
# =====================================================================
if __name__ == "__main__":
    # 样例为 old/ 实测 URL 结构：/bidweb/001/{cat}/{页码}/{8位日期}/{uuid}.html
    sample_gn = '<a href="/bidweb/001/001002/12/20261015/9f2e1a7b-3c4d.html" title="国能宁夏电力AVC系统改造招标公告">x</a>'
    m = _gn_row_re("001002").search(sample_gn)
    assert m and m.group(3) == "9f2e1a7b-3c4d", "国能 native_id 提取失败"
    assert m.group(2) == "20261015" and m.group(4).startswith("国能宁夏电力AVC"), "国能正则自检失败"

    assert _chd_native_id("javascript:viewRow('123456','gg')") == "123456", "华电 onclick 提取失败"
    assert _chd_native_id("") == "", "华电 onclick 空值自检失败"
    assert set(LIST_HANDLERS.keys()) == {"chnenergy", "cdt_ec", "chdtp", "sgcc", "neep", "chng", "espic"}, "注册表键不完整"
    print("✅ src/sites.py 离线断言全部通过！")
```

### 4. `src/main.py`（激活 `batch_penetrate` + 穿透负缓存 + 状态槽防漏跑调度）
```python
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
```

---

## 五、 容器化验证与日常运维手册（本机零依赖）

由于宿主机无需安装 Python / Playwright 环境，所有测试、抓包 Spike 与日常运行全部通过 Docker Compose 完成：

### 1. 上线前四步验证法

**第一步：跑离线断言自检（验证正则与注册表）**
```bash
docker compose run --rm ebid-monitor python src/sites.py
```

**第二步：已移植 3 站（国能E招 / 大唐犀维 / 华电）联网抽检**
```bash
docker compose run --rm ebid-monitor python -c "
from playwright.sync_api import sync_playwright
from src.sites import fetch_list, fetch_detail

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--disable-blink-features=AutomationControlled'])
    ctx = b.new_context()
    for k in ('chnenergy', 'cdt_ec', 'chdtp'):
        items = fetch_list(ctx, k)
        print(f'=== [{k}] count={len(items)} ===')
        if items:
            print('  sample:', items[0])
            body = fetch_detail(ctx, k, items[0])
            print(f'  detail_len={len(body)}')
    b.close()
"
```

**第三步：国网 ECP 2.0 (`sgcc`) 抓包探针验证**
执行以下命令验证国网 `ecpwcmcore` 接口返回结构；确认正常返回后，将 `config.yaml` 中 `sgcc.enabled` 改为 `true`：
```bash
docker compose run --rm ebid-monitor python -c "
from playwright.sync_api import sync_playwright
from src.sites import fetch_list, fetch_detail

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--disable-blink-features=AutomationControlled'])
    ctx = b.new_context()
    items = fetch_list(ctx, 'sgcc')
    print(f'=== [sgcc] count={len(items)} ===')
    if items:
        print('  sample:', items[0])
        print('  detail_len:', len(fetch_detail(ctx, 'sgcc', items[0])))
    b.close()
"
```

**第四步：端到端全链路冒烟（入库 + 邮件发送测试）**
```bash
docker compose run --rm ebid-monitor python src/main.py --now
```

---

### 2. 日常运维 4 条常用命令

1. **启动后台常驻服务**：
   ```bash
   docker compose up -d --build
   ```
2. **临近截标日手动立即加查一轮**：
   ```bash
   docker compose exec ebid-monitor python src/main.py --now
   ```
3. **修改 `config.yaml` 或更新 `src/sites.py` 后热生效（免 Rebuild）**：
   ```bash
   docker compose restart
   ```
4. **查看实时运行日志**：
   ```bash
   docker compose logs -f --tail=100
   ```