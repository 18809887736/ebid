# -*- coding: utf-8 -*-
"""mock-web 单测：Flask test client 直接驱动，不需要 Docker。
运行：python -m pytest tests/unit -q   （需 pip install flask pytest）"""
import importlib
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from mockweb import app as mockweb_app  # noqa: E402

GN_LIST = "/guoneng/bidweb/001/001002/moreinfo.html"
# 与未来国能适配器同形的抽取正则（路径多 /guoneng 前缀，结构不变）
GN_RE = re.compile(
    r'href="(/guoneng/bidweb/001/001002/(\d+?)/(\d{8})/[0-9a-f\-]+\.html)"[^>]*title="([^"]+)"')
CW_API = "/cweme/cweme-index/indexController/getList"


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("MOCK_ADMIN_TOKEN", "test-token")
    module = importlib.reload(mockweb_app)  # 重置内存场景/计数状态
    module.app.config["TESTING"] = True
    return module.app.test_client()


def switch(client, site, mode, token="test-token"):
    r = client.get(f"/__admin/scenario?site={site}&mode={mode}&token={token}")
    assert r.status_code == 200
    return r


def test_health(client):
    j = client.get("/__health").get_json()
    assert j["ok"] is True and "today" in j


def test_admin_requires_token(client):
    assert client.get("/__admin/reset").status_code == 403
    assert client.get("/__admin/scenario?site=chd&mode=empty").status_code == 403
    assert client.get("/__admin/scenario?site=chd&mode=empty&token=wrong").status_code == 403


def test_admin_rejects_unknown_mode(client):
    r = client.get("/__admin/scenario?site=chd&mode=bogus&token=test-token")
    assert r.status_code == 400


def test_guoneng_normal_list_and_detail(client):
    html = client.get(GN_LIST).get_data(as_text=True)
    m = GN_RE.search(html)
    assert m, "列表必须保留 href+title 结构供适配器正则抽取"
    assert "AGC" in m.group(4)  # 标题抽取成功
    assert "暂无数据" not in html
    d = client.get(m.group(1))
    assert d.status_code == 200 and "ewb-content" in d.get_data(as_text=True)
    assert client.get("/guoneng/bidweb/001/001002/9999/20260101/nope.html").status_code == 404


def test_guoneng_page2_and_cats(client):
    for url in ("/guoneng/bidweb/001/001002/2.html", "/guoneng/bidweb/001/001003/moreinfo.html",
                "/guoneng/bidweb/001/001004/moreinfo.html"):
        assert client.get(url).status_code == 200


def test_empty_mode_zero_links(client):
    switch(client, "guoneng", "empty")
    html = client.get(GN_LIST).get_data(as_text=True)
    assert re.findall(r"/001002/\d+/\d{8}/", html) == []
    switch(client, "cweme", "empty")
    j = client.post(CW_API, data={"messagetype": "0"}).get_json()
    assert j["data"] == []


def test_error5xx(client):
    switch(client, "guoneng", "error5xx")
    assert client.get(GN_LIST).status_code == 500


def test_timeout_mode(client, monkeypatch):
    monkeypatch.setenv("MOCK_TIMEOUT_SECONDS", "0.05")
    switch(client, "cweme", "timeout")
    r = client.post(CW_API, data={"messagetype": "0", "message_title": "AVC"})
    assert r.status_code == 200


def test_layout_changed_breaks_extractor(client):
    switch(client, "guoneng", "layout_changed")
    html = client.get(GN_LIST).get_data(as_text=True)
    assert GN_RE.search(html) is None
    assert "notice-board" in html


def test_changed_notice_appears_only_in_mode(client):
    base = "/guoneng/bidweb/001/001004/moreinfo.html"
    normal = client.get(base).get_data(as_text=True)
    assert "龙山电厂" not in normal  # 变更公告不在 normal 数据里
    switch(client, "guoneng", "changed_notice")
    changed = client.get(base).get_data(as_text=True)
    assert "变更公告" in changed and "龙山电厂" in changed


def test_poisoned_mode(client):
    base = client.get(GN_LIST).get_data(as_text=True)
    assert "attacker.example.com" not in base and "忽略以上" not in base
    switch(client, "guoneng", "poisoned")
    html = client.get(GN_LIST).get_data(as_text=True)
    assert "忽略以上" in html
    href = [m.group(1) for m in GN_RE.finditer(html) if "deadbe01" in m.group(1)][0]
    detail = client.get(href).get_data(as_text=True)
    assert 'href="http://attacker.example.com/collect"' in detail  # 非白名单域名链接


def test_truncated_titles_rotate(client):
    switch(client, "guoneng", "truncated_titles")
    titles = []
    for _ in range(2):
        m = GN_RE.search(client.get(GN_LIST).get_data(as_text=True))
        titles.append(m.group(4))
    assert all(t.endswith("…") for t in titles)
    assert titles[0] != titles[1]  # 每轮截断点不同


def test_chd_outer_and_iframe(client):
    outer = client.get("/chd/pages/wzglS/cgxx/caigou.jsp").get_data(as_text=True)
    assert 'id="iframepage4"' in outer
    r = client.get("/chd/webs/queryWebZbgg.action?zbggType=1&ggbt=AVC")
    body = r.get_data(as_text=True)
    assert "AVC" in body and "onclick" in body  # a[onclick] 结构在
    assert "AGC" not in body  # ggbt 关键词过滤生效
    assert client.get("/chd/webs/queryWebZbgg.action?zbggType=1&ggbt=AVC").status_code == 200


def test_cweme_api_filter_and_paginate(client):
    j = client.post(CW_API, data={"messagetype": "0", "message_title": ""}).get_json()
    assert j["count"] == 3 and len(j["data"]) == 3  # normal: 2 相关 + 1 无关
    j1 = client.post(CW_API, data={"messagetype": "0", "message_title": "", "limit": "2", "page": "1"}).get_json()
    j2 = client.post(CW_API, data={"messagetype": "0", "message_title": "", "limit": "2", "page": "2"}).get_json()
    assert len(j1["data"]) == 2 and len(j2["data"]) == 1
    assert j1["data"][0]["gg_id"] != j2["data"][0]["gg_id"]
    kavc = client.post(CW_API, data={"messagetype": "0", "message_title": "AVC"}).get_json()
    assert kavc["count"] == 1 and "洛阳" in kavc["data"][0]["message_title"]
    row = kavc["data"][0]
    assert set(row) >= {"gg_id", "message_title", "pro_bidding_mothod", "publish_time",
                        "bid_tenderer", "message_no", "deadline"}  # v1 适配器字段齐


def test_cweme_layout_changed(client):
    switch(client, "cweme", "layout_changed")
    j = client.post(CW_API, data={"messagetype": "0"}).get_json()
    assert "data" not in j and "rows" in j  # 字段改版：旧适配器失效


def test_scenario_preset_and_reset(client):
    r = client.get("/__admin/scenario?preset=poison-all&token=test-token")
    assert r.status_code == 200
    assert client.get("/__health").get_json()["scenarios"]["guoneng"] == "poisoned"
    assert client.get("/__admin/scenario?preset=missing&token=test-token").status_code == 404
    client.get("/__admin/reset?token=test-token")
    assert client.get("/__health").get_json()["scenarios"] == {}


def test_sink_webhook(client):
    r = client.post("/__sink/webhook?token=test-token", data="hello")
    assert r.get_json()["ok"] is True
    assert client.post("/__sink/webhook").status_code == 403
    switch(client, "sink", "error5xx")
    assert client.post("/__sink/webhook?token=test-token").status_code == 500
