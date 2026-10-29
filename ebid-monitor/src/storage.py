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
