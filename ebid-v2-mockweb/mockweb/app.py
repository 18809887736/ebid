# -*- coding: utf-8 -*-
"""自建测试 WEB (mock): 3 个站点页面/接口 + 场景开关。

规格见 ebid-v2-mockweb.md。站点数据在 sites/<站点>/data.json，
发布日期用 offset(相对"今天")生成，MOCK_TODAY 可冻结"今天"。
容器内由 flask run 启动；无 Docker 时 `python -m mockweb` 裸跑(后备方案)。
"""
import json
import os
import threading
import time
from datetime import date, timedelta
from pathlib import Path

import jinja2
from flask import Flask, abort, jsonify, render_template, request

BASE_DIR = Path(__file__).resolve().parent
SITES_DIR = BASE_DIR / "sites"
SCENARIOS_DIR = BASE_DIR / "scenarios"

MODES = {"normal", "empty", "error5xx", "timeout", "layout_changed",
         "truncated_titles", "changed_notice", "poisoned"}

app = Flask(__name__)
# 模板分散在 sites/<站点>/ 下，模板名形如 "guoneng/list.html"
app.jinja_loader = jinja2.FileSystemLoader(str(SITES_DIR))

_lock = threading.Lock()
_scenarios = {}   # site -> mode；未设置即 normal，重启复位
_counters = {}    # site -> 请求序号，truncated_titles 每轮换截断点
_sink = []        # /__sink/webhook 收到的内容


def admin_token():
    return os.environ.get("MOCK_ADMIN_TOKEN", "dev-token")


def today():
    frozen = os.environ.get("MOCK_TODAY", "").strip()
    return date.fromisoformat(frozen) if frozen else date.today()


def iso(offset):
    return (today() + timedelta(days=offset)).isoformat()


def ymd8(offset):
    return iso(offset).replace("-", "")


def day_at(spec):
    # spec: {"offset": n} 相对今天，或 "YYYY-MM-DD" 字面量
    return spec if isinstance(spec, str) else iso(spec.get("offset", 0))


def load_site(site):
    return json.loads((SITES_DIR / site / "data.json").read_text(encoding="utf-8"))


def mode_of(site):
    return _scenarios.get(site, "normal")


def guard(site):
    """场景公共行为：error5xx -> 500；timeout -> 长时间不响应。"""
    mode = mode_of(site)
    if mode == "error5xx":
        abort(500)
    if mode == "timeout":
        time.sleep(float(os.environ.get("MOCK_TIMEOUT_SECONDS", "120")))
    return mode


def check_token():
    if request.args.get("token") != admin_token():
        abort(403, description="missing/invalid token (MOCK_ADMIN_TOKEN)")


def visible_entries(data, mode):
    # 无标签 = 基础数据；changed/poison 只在对应场景放出
    extra = {"changed_notice": "changed", "poisoned": "poison"}.get(mode)
    return [e for e in data["notices"]
            if not e.get("tags") or extra in e["tags"]]


def next_counter(site):
    with _lock:
        _counters[site] = _counters.get(site, 0) + 1
        return _counters[site]


_CUTS = (0.45, 0.62, 0.8)


def display_title(title, mode, rnd):
    """truncated_titles：按轮次(请求序号)换截断点，同一轮内所有标题同一比例。"""
    if mode != "truncated_titles" or len(title) < 12:
        return title
    cut = _CUTS[rnd % len(_CUTS)]
    return title[: max(8, int(len(title) * cut))] + "…"


# ---------------- 管理与接收 ----------------

@app.get("/__health")
def health():
    return jsonify({"ok": True, "today": today().isoformat(),
                    "scenarios": dict(_scenarios)})


@app.get("/__admin/scenario")
def admin_scenario():
    check_token()
    preset = request.args.get("preset")
    if preset:
        path = SCENARIOS_DIR / f"{preset}.json"
        if not path.is_file():
            abort(404, description=f"preset not found: {preset}")
        applied = json.loads(path.read_text(encoding="utf-8"))
        unknown = set(applied.values()) - MODES
        if unknown:
            abort(400, description=f"unknown modes: {sorted(unknown)}")
        with _lock:
            _scenarios.update(applied)
        return jsonify({"ok": True, "applied": applied})
    site = request.args.get("site", "")
    mode = request.args.get("mode", "normal")
    if not site:
        abort(400, description="site required")
    if mode not in MODES:
        abort(400, description=f"mode must be one of {sorted(MODES)}")
    with _lock:
        _scenarios[site] = mode
    return jsonify({"ok": True, "site": site, "mode": mode})


@app.get("/__admin/reset")
def admin_reset():
    check_token()
    with _lock:
        _scenarios.clear()
        _counters.clear()
    return jsonify({"ok": True})


@app.post("/__sink/webhook")
def sink_webhook():
    check_token()
    if mode_of("sink") == "error5xx":
        abort(500)
    with _lock:
        _sink.append({"at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                      "body": request.get_data(as_text=True)[:4000]})
    return jsonify({"ok": True, "received": len(_sink)})


# ---------------- 国能E招（静态列表 + 详情） ----------------

@app.get("/guoneng/bidweb/001/<cat>/<page>.html")
def gn_list(cat, page):
    mode = guard("guoneng")
    data = load_site("guoneng")
    catname = data["cats"].get(cat)
    if catname is None:
        abort(404)
    rnd = next_counter("guoneng")
    rows = [] if mode == "empty" else [
        {**e, "ymd": ymd8(e.get("offset", 0)),
         "date_s": iso(e.get("offset", 0)),
         "title": display_title(e["title"], mode, rnd)}
        for e in visible_entries(data, mode) if e["cat"] == cat]
    tpl = "guoneng/list_changed.html" if mode == "layout_changed" else "guoneng/list.html"
    return render_template(tpl, cat=cat, catname=catname, page=page, rows=rows)


@app.get("/guoneng/bidweb/001/<cat>/<int:n>/<ymd>/<slug>.html")
def gn_detail(cat, n, ymd, slug):
    mode = guard("guoneng")
    data = load_site("guoneng")
    for e in visible_entries(data, mode):
        if e["cat"] == cat and e["slug"] == slug:
            return render_template(
                "guoneng/detail.html", e=e, catname=data["cats"].get(cat, cat),
                date_s=iso(e.get("offset", 0)),
                deadline_s=day_at(e["deadline"]) if e.get("deadline") else "")
    abort(404)


# ---------------- 华电（外层页 + iframe 搜索） ----------------

@app.get("/chd/pages/wzglS/cgxx/caigou.jsp")
def chd_outer():
    guard("chd")
    return render_template("chd/outer.html")


@app.get("/chd/webs/queryWebZbgg.action")
def chd_iframe():
    mode = guard("chd")
    kw = request.args.get("ggbt", "")
    data = load_site("chd")
    rnd = next_counter("chd")
    rows = [] if mode == "empty" else [
        {"status": e.get("status", "公告"), "type": e.get("type", "公开招标"),
         "title": display_title(e["title"], mode, rnd),
         "date": iso(e.get("offset", 0)), "onclick_id": e["onclick_id"]}
        for e in visible_entries(data, mode)
        if not kw or kw.lower() in e["title"].lower()]
    tpl = "chd/iframe_changed.html" if mode == "layout_changed" else "chd/iframe.html"
    return render_template(tpl, rows_json=json.dumps(rows))


# ---------------- 大唐/犀维（同源页面 + POST JSON 接口） ----------------

@app.get("/cweme/cweme-index/webpage/jsp/zbggList.jsp")
def cw_list_page():
    guard("cweme")
    return render_template("cweme/list.html")


@app.post("/cweme/cweme-index/indexController/getList")
def cw_api():
    mode = guard("cweme")
    kw = request.form.get("message_title", "")
    mt = request.form.get("messagetype", "0")
    try:
        limit = max(1, int(request.form.get("limit") or 30))
        page_no = max(1, int(request.form.get("page") or 1))
    except ValueError:
        abort(400, description="limit/page must be integers")
    data = load_site("cweme")
    rnd = next_counter("cweme")
    rows = [] if mode == "empty" else [
        {"gg_id": e["id"], "id": e["id"],
         "message_title": display_title(e["title"], mode, rnd),
         "pro_bidding_mothod": e.get("method", ""),
         "publish_time": iso(e.get("offset", 0)) + " 10:00:00",
         "bid_tenderer": e.get("org", ""), "message_no": e.get("no", ""),
         "deadline": (day_at(e["deadline"]) + " 15:00") if e.get("deadline") else ""}
        for e in visible_entries(data, mode)
        if e["type"] == mt and (not kw or kw.lower() in e["title"].lower())]
    start = (page_no - 1) * limit
    if mode == "layout_changed":
        return jsonify({"count": len(rows), "rows": rows[start:start + limit]})
    return jsonify({"count": len(rows), "limit": limit, "page": page_no,
                    "data": rows[start:start + limit]})
