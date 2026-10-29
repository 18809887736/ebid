# -*- coding: utf-8 -*-
"""站点采集适配器 — fetch_list / fetch_detail 两级接口.

fetch_list(ctx, site_key)        -> list[dict]  公告全量列表(不做词库过滤,过滤在 main.py)
fetch_detail(ctx, site_key, item)-> str         公告正文纯文本(批次穿透二次匹配用),站点不支持返回 ""

ctx 为 playwright.sync_api.BrowserContext;纯 HTTP 站点(国能E招)忽略它。
item 字段与 storage.make_dedupe_key 对齐: native_id/title/notice_type/pub_date/deadline/url

已移植自 old/run_check.py + old/scripts/check_chd_cweme.mjs(2026-10 实测可用的逻辑):
  chnenergy 国能E招 / chdtp 华电 / cdt_ec 大唐犀维
sgcc/neep/chng/espic 无历史代码与已验证接口,为显式 raise 的占位,请在 config.yaml 置 enabled:false。
"""

import re
import logging

logger = logging.getLogger("ebid")

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
}


# ---------------- 国能E招 chnenergybidding.com.cn (纯 HTTP, 移植自 old check_guoneng) ----------------

GN_HOST = "http://www.chnenergybidding.com.cn"
GN_CATS = {"001002": "招标公告", "001003": "非招标公告", "001004": "变更公告"}


def _gn_row_re(cat: str) -> re.Pattern:
    return re.compile(
        r'href="(/bidweb/001/' + cat + r'/\d+?/(\d{8})/([0-9a-f\-]+)\.html)"[^>]*title="([^"]+)"'
    )


def _chnenergy_list(ctx) -> list[dict]:
    import httpx

    items = []
    with httpx.Client(headers=UA, timeout=25, follow_redirects=True) as c:
        for cat, catname in GN_CATS.items():
            for page in ("moreinfo.html", "2.html", "3.html"):
                url = f"{GN_HOST}/bidweb/001/{cat}/{page}"
                r = c.get(url)
                r.raise_for_status()
                for m in _gn_row_re(cat).finditer(r.text):
                    path, ymd, native_id, title = m.groups()
                    items.append({
                        "native_id": native_id,
                        "title": title,
                        "notice_type": catname,
                        "pub_date": f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:]}" if len(ymd) == 8 else "",
                        "deadline": "",
                        "url": GN_HOST + path,
                    })
    return items


def _chnenergy_detail(ctx, item: dict) -> str:
    import httpx
    from bs4 import BeautifulSoup

    with httpx.Client(headers=UA, timeout=25, follow_redirects=True) as c:
        r = c.get(item["url"])
        r.raise_for_status()
        return BeautifulSoup(r.text, "html.parser").get_text(" ", strip=True)


# ---------------- 大唐(犀维网) cweme.cn (浏览器上下文 POST, 移植自 old checkCweme) ----------------

CWEME_LIST_PAGE = "https://www.cweme.cn/cweme-index/webpage/jsp/zbggList.jsp"
CWEME_API = "https://www.cweme.cn/cweme-index/indexController/getList"
CW_TYPES = {"0": "招标公告", "1": "变更公告", "4": "非招标公告"}


def _cdt_ec_list(ctx) -> list[dict]:
    items = []
    page = ctx.new_page()
    try:
        # 先开列表页拿会话 cookie,再走 ctx.request 复用 cookie 调接口(等价 old 的 page.fetch)
        page.goto(CWEME_LIST_PAGE, timeout=45000)
        try:
            page.wait_for_load_state("networkidle", timeout=20000)
        except Exception:
            pass
        for mt, typename in CW_TYPES.items():
            r = ctx.request.post(CWEME_API, form={
                "limit": "30", "page": "1", "messagetype": mt, "message_title": "",
                "bid_tenderer": "", "message_no": "", "pro_bidding_mothod": "",
                "startDate": "", "endDate": "",
            }, timeout=15000)
            if r.status != 200:
                raise RuntimeError(f"犀维 getList HTTP {r.status} messagetype={mt}")
            for g in r.json().get("data", []):
                gid = str(g.get("gg_id") or g.get("id") or "")
                detail_jsp = "zbggDetail" if mt in ("0", "1") else "fzbggDetail"
                items.append({
                    "native_id": gid,
                    "title": g.get("message_title", ""),
                    "notice_type": typename,
                    "pub_date": (g.get("publish_time") or "")[:10],
                    "deadline": (g.get("deadline") or "")[:10],
                    "url": f"https://www.cweme.cn/cweme-index/webpage/jsp/{detail_jsp}.jsp?id={gid}",
                })
    finally:
        page.close()
    return items


def _cdt_ec_detail(ctx, item: dict) -> str:
    from bs4 import BeautifulSoup

    r = ctx.request.get(item["url"], timeout=20000)
    if r.status != 200:
        return ""
    return BeautifulSoup(r.text(), "html.parser").get_text(" ", strip=True)


# ---------------- 华电 chdtp.com (Playwright iframe 查询, 移植自 old checkChd) ----------------

CHD_PAGE = "https://www.chdtp.com/pages/wzglS/cgxx/caigou.jsp?cgtype=4"
CHD_QUERY = "https://www.chdtp.com/webs/queryWebZbgg.action?zbggType=1&ggbt="


def _chd_native_id(onclick: str) -> str:
    m = re.search(r"\d{4,}", onclick or "")
    return m.group(0) if m else ""


def _chdtp_list(ctx) -> list[dict]:
    page = ctx.new_page()
    try:
        page.goto(CHD_PAGE, timeout=45000)
        try:
            page.wait_for_load_state("networkidle", timeout=20000)
        except Exception:
            pass
        page.wait_for_timeout(2000)
        # 空关键词=全量列表,本地做词库过滤; shortcut: 若站点拒绝空 ggbt,退回 ggbt=AVC/AGC 两次站内搜索(标题会被截断)
        page.evaluate(
            '() => { const f = document.querySelector("#iframepage4");'
            f'if (f) f.src = "{CHD_QUERY}"; return !!f; }}'
        )
        page.wait_for_timeout(4000)
        rows = page.evaluate(
            """() => {
                const f = document.querySelector("#iframepage4");
                const doc = f && f.contentDocument;
                if (!doc || !doc.body) return [];
                return [...doc.querySelectorAll("tr")].map(tr => {
                    const c = [...tr.querySelectorAll("td")].map(td => (td.textContent || "").trim());
                    const a = tr.querySelector("a[onclick]");
                    return { status: c[0] || "", title: c[1] || "", type: c[2] || "",
                             date: (c[3] || "").replace(/[\\[\\]]/g, ""),
                             onclick: a ? a.getAttribute("onclick") : "" };
                }).filter(r => r.title.length > 8);
            }"""
        )
        # 站点正文无直链 URL(行为 onclick 跳转),所有条目统一指向列表页,去重靠 native_id
        return [{
            "native_id": _chd_native_id(r["onclick"]),
            "title": r["title"],
            "notice_type": r["type"] or "招标公告",
            "pub_date": r["date"],
            "deadline": "",
            "url": CHD_PAGE,
        } for r in rows]
    finally:
        page.close()


# ---------------- 未实现站点(无历史代码/未验证接口) ----------------

def _todo(site: str, strategy: str):
    def handler(ctx):
        raise RuntimeError(f"{site} 适配器未实现,计划策略: {strategy}")
    return handler


_LIST_HANDLERS = {
    "chnenergy": _chnenergy_list,
    "cdt_ec": _cdt_ec_list,
    "chdtp": _chdtp_list,
    "sgcc": _todo("sgcc 国家电网ECP2.0", "Playwright page.expect_response 拦截公告列表 JSON 接口,批次公告再拉正文"),
    "neep": _todo("neep 国家能源e购", "httpx 直抓询比价公开列表接口"),
    "chng": _todo("chng 华能电商", "httpx/轻量渲染抓 ec.chng.com.cn 公开招标列表"),
    "espic": _todo("espic 国电投电能易购", "公开 API 或浏览器拦截 ebid.espic.com.cn"),
}

_DETAIL_HANDLERS = {
    "chnenergy": _chnenergy_detail,
    "cdt_ec": _cdt_ec_detail,
}


def fetch_list(ctx, site_key: str) -> list[dict]:
    return _LIST_HANDLERS[site_key](ctx)


def fetch_detail(ctx, site_key: str, item: dict) -> str:
    h = _DETAIL_HANDLERS.get(site_key)
    return h(ctx, item) if h else ""


if __name__ == "__main__":
    # 离线自检: 不联网,只验证解析规则(国能E招行正则 / 华电 onclick 提取)
    gn_html = ('<li><a href="/bidweb/001/001002/12/20261015/9f2e1a7b-3c4d.html" '
               'title="某风电场AVC系统升级改造招标公告" target="_blank">x</a></li>')
    m = _gn_row_re("001002").search(gn_html)
    assert m and m.group(3) == "9f2e1a7b-3c4d" and m.group(4).startswith("某风电场AVC"), "国能E招行正则失效"
    assert _chd_native_id("viewXm('123456','gg')" ) == "123456"
    assert _chd_native_id("") == ""
    assert set(_LIST_HANDLERS) == {"chnenergy", "cdt_ec", "chdtp", "sgcc", "neep", "chng", "espic"}
    print("sites.py 自检通过")
