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
        # 空关键词=全量列表(仅首页约20条,提供最新公告与改版判据)
        items = _chdtp_query(page, "")
        if not items:
            logger.warning("[chdtp] 空 ggbt 返回 0 条，自动降级为关键词站内搜索模式")
        # 站内搜索回捞历史公告：全量列表翻页契约未知，关键词搜索可覆盖全部历史；
        # 搜索结果标题可能被"..."截断导致本地 include 匹配失败，标记 search_hit 交由 main 放行
        seen = {(it["native_id"] or it["title"]) for it in items}
        for kw in ("AVC", "AGC", "自动电压", "自动发电"):
            for it in _chdtp_query(page, kw):
                key = it["native_id"] or it["title"]
                if key in seen:
                    continue
                seen.add(key)
                it["search_hit"] = True
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
