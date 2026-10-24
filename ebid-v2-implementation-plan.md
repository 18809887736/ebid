# 电力招投标监控系统 v2 实施方案

基于《需求v2-重构与AI最佳实践征询》（现位于 old/）与可行性评估 · 2026-10-24 · 单人维护、Windows 11 本机、ego(lite) 浏览器；审阅问题清单见 ebid-v2-plan-review.md

## 1. 目标、范围与红线

- 目标：尽早、可靠地发现各电力集团的 AVC/AGC 招标公告；系统一旦出问题，你一定会知道。
- 范围：先稳住 v1（3 站），再按实测结果扩展；登录类站点放最后评估，不为扩展而扩展。
- 红线（贯穿所有阶段）：生产定时任务只走确定性脚本，AI 不驱动任何已登录的浏览器会话。
- 生产链路只有一条：任务计划程序 → run_check.py → ego-browser nodejs < adapters/…。链路中不出现任何 LLM Agent 命令行（Claude Code、Codex、Gemini CLI 等）。
- AI 只在人在场时参与开发：写、改适配器，分析页面结构；使用 dev-* 命名的未登录空间，不碰 bid-* 生产空间。
- 公告页面内容一律视为不可信数据：适配器只抽取白名单字段，限制长度并清洗控制字符，绝不把页面文字拼进脚本或命令。
- 公共库封装导航函数，强制 URL 前缀白名单；不实现任何「报名 / 投标 / 提交」类操作，即使会话有权限也做不到。
- 可选的 AI 摘要（Phase 2 之后再议）只处理已抽取的纯文本：无工具、无浏览器，失败即回退原文，输出只用于邮件文案，不参与「是否通知」的判断。
- 上线自检：tools/check_redline.py 扫描 run_check.py、core/、adapters/，发现 agent CLI 调用或非白名单域名即失败；适配器每次改动经你人工看 diff 后才上线；同时检查生产配置的 URL 白名单不含 mock 站点地址（见 4.5）。

## 2. 阶段总览

| 阶段 | 内容 | 粗估工作量 | 退出标准 |
|---|---|---|---|
| Phase 0 | 修 v1 三个可靠性坑 + 任务计划程序调度 | 1–1.5 天 | 故障演练全部通过，无人值守连跑 3 天 |
| Phase 1 | 自建测试 WEB（Docker 化 mock 站点）+ 适配器接口、统一 schema、SQLite 重构（仍是原 3 站） | 5–6.5 天（其中测试 WEB 含 Docker 环境 2–2.5 天） | mock E2E 全绿，新旧并行 3 天结果一致后切换 |
| Phase 2 | 逐站实测公开可见性，按公告量依次接入（每站先进 mock） | 实测 1 天 + 每站 1.5–2.5 天 | 每站灰度 2 轮后正式启用 |
| Phase 3 | 评估必须登录的站点（含登录与会话失效 mock） | 决策 0.5 天；实施每站 2–4 天，登录 mock 另加 0.5–1 天（可能不做） | 通过决策门才实施 |

工作量是单人、熟悉现有代码的粗估，单位为有效工作日。每个阶段结束打 git tag，保留回滚点。

## 3. Phase 0：修 v1 可靠性 + 任务计划调度

0.0 前置：凭据清理。若 README 里的明文账号密码尚未处理：先改密码和证书口令，仓库转私有，再清 git 历史（git filter-repo 或重建仓库）。同时补全.gitignore：data/、logs/、任何凭据文件。

### 0.1 修「邮件先落库」

- 现状：run_check.py 先把新公告写入 seen.json，再发邮件；邮件失败时这些公告永远不会再通知。
- 改法：只有发送成功才落库。

```python
fresh_new, stale_new = split(new_items) # stale = 超过 FRESH_DAYS, 本来就不通知
mark_seen(stale_new) # 不通知的老公告直接标记
if baseline: mark_seen(fresh_new); return # 基线模式旧
if no_email: return # 演练模式不写库, 避免吞掉公告
ok = send_with_retry(fresh_new) # 立即 / 30 秒 / 2 分钟, 各 1 次
if not ok: ok = send_via_smtp(fresh_new) # agently 失败再走 SMTP 备用
if ok: mark_seen(fresh_new) # 只有发送成功才落库
else: write_local_alert(); sys.exit(2) # 保持未通知, 下一轮自动重试
```

- 发送成功的判定增加进程返回码检查，不只依赖输出里的 ok 字符串。
- 取舍：若邮件实际已发出但响应解析失败，下一轮可能重复通知一次——宁重勿漏。

### 0.2 修「静默失败」

- 现状：站点抓取出错只会在「恰好有新公告」时才随邮件带出，其余时候无人知晓。
- 每站每轮记录结果：成功与否、列表总条数 raw_count（关键词过滤之前）、命中条数、错误信息。适配器需要把 raw_count 返回出来。
- 告警规则：
- 单站连续失败 ≥ 2 轮 → 发独立告警邮件，主题固定为「【告警】<站点> 连续失败 N 轮」；同一站点 24 小时内最多 1 封。
- 站点此前稳定有列表数据，本轮 raw_count 为 0 → 视为疑似改版，同样告警。
- ego 整体无产出（浏览器站全挂）→ 告警。
- 站点恢复 → 发一封恢复通知。
- 退出码：CLEAN / FOUND 为 0，WARN 为 2，任务计划程序里能直接看到失败。
- 状态先存 data/state.json（站点连续失败数、上次告警时间），Phase 1 并入 SQLite。

### 0.3 补「心跳」

- 每日固定一封日报（建议 08:30 那一轮结束后发），主题固定，无新公告也发。内容：各站 24 小时内成功次数、抓取总条数、新增数、最近一条相关公告的日期。
- 「没收到日报」本身就是系统异常的信号（任务计划挂了、电脑关机、邮件通道坏了）。不依赖云端 ping，符合「不上云」约束。

### 0.4 迁移到任务计划程序

- 触发器：08:30 与 14:30 两个。
- 运行条件：仅当用户登录时运行（ego 是桌面应用，注销后无法运行，锁屏没问题）；允许唤醒计算机；错过后尽快运行；不并行启动新实例。
- 失败处理：失败后 10 分钟重试，最多 2 次；任务时间上限 30 分钟。
- 操作：程序填 conda 环境里 python 的绝对路径，参数 run_check.py，起始于 C:/work/ebid（v2 仓库根，见 4.1）；标准输出重定向到 data/logs/run_日期_时间.log，保留 30 天。
- 切换顺序：先暂停 Claude 应用里的 avc-agc-bid-watch，再启用新任务，避免双发和并发写 seen.json。

### 0.5 进程超时

subprocess.run(timeout) 只杀直接子进程。改为 Popen，超时后 taskkill /PID <pid> /T /F 清理整个进程树，并设分站超时（建议 4 分钟）与总超时（建议 25 分钟）。

涉及文件：run_check.py（改）、data/state.json（新）、.gitignore（改）。

退出标准（故障演练）：
1. 故意让 agently 和 SMTP 都失败：新公告不丢，恢复后下一轮补发。
2. 把某站 URL 改错：2 轮后收到告警，改回后收到恢复通知。
3. 日报每天按时到达。
4. 任务计划无人干预连续运行 3 天。

说明：Phase 0 不依赖测试 WEB，演练 2 先用改错 URL 手工完成；测试 WEB 在 Phase 1 建好后，这四项演练会改写成可重复的自动化 E2E 用例（见 4.5）。

## 4. Phase 1：适配器接口、统一 schema、SQLite

### 4.1 目录结构

```
ebid/ # 仓库根 C:/work/ebid
run_check.py # 薄入口
core/ # Python: config, db, dedupe, runner, notify, report, keywords
adapters/ # 每站一个适配器 (.mjs 浏览器站 /.py 静态站)
_lib/common.mjs # 公共库: 导航白名单、等待、清洗、输出
config/sites.json # 站点开关, space 名, 是否通知, 检查频率
config/sites.mock.json # 测试环境: 基址用 ${MOCK_BASE}, 指向本机容器 (仅测试用)
docker-compose.yml # 测试 WEB: mock-web (+ 可选 mailpit)
.env.example # MOCK_PORT=18080 等; 真实.env 不入库
.gitattributes # *.sh 等强制 LF
mockweb/ # 自建测试 WEB (见 4.5)：app.py、sites/、scenarios/、Dockerfile、requirements.txt、.dockerignore
scripts/mock.cmd # up / down / watch / logs 的封装
data/bid.db data/out/<站点>.json data/logs/
tests/ (unit/ e2e/ fixtures/) tools/check_redline.py
```

- 国能E招这类静态站保留 Python 适配器，与浏览器适配器输出同一种 JSON，不为统一而重写。
- 先做 1 小时 spike：验证 ego-browser nodejs < 脚本 这种 stdin 方式下，相对路径 import 是否可用。不可用就改用绝对 file URL 动态 import()，或由 Python 把 _lib/common.mjs 与适配器拼接后再喂给 ego。

### 4.2 适配器输出约定（每站一个文件，故障互相隔离）

```json
{ "site": "华电", "ok": true, "error": null, "session_state": "public",
"raw_count": 20, "items": [ { "title": "…", "notice_type": "招标公告",
"published_date": "2026-10-20", "url": "…", "native_id": "…",
"deadline": "", "org": "", "project_no": "", "channel": "dom"}
]}
```

### 4.3 SQLite 表

| 表 | 关键字段 |
|---|---|
| notices | id、site、native_id、title、title_norm、notice_type、published_date、url、deadline、org、project_no、first_seen |
| runs | id、started_at、finished_at、result、mail_status |
| site_runs | run_id、site、ok、error、raw_count、matched_count、new_count、session_state、duration_s |
| site_state | site、consecutive_failures、last_ok_at、last_alert_at、last_nonzero_raw_at |

- dedupe_key = 站点 + 类型 + (native_id 或 sha1(title_norm + 日期))。
- title_norm：去掉省略号和空白、统一全半角，解决 v1 浏览器站标题被截断导致同条公告键不稳定的问题。
- 变更公告的类型进入键，作为新事件通知（截止时间变更对投标很关键）。
- notified_at 为空即待通知——这是 Phase 0.1 修复在数据层的通用化；用 sqlite3 标准库，写入走事务，避免 seen.json 的非原子写入问题。
- 同键内容变化：dedupe 命中后比较 deadline 与标题哈希，任一变化即视为新事件重新通知并更新记录——覆盖「同一公告原地更新、截止时间二次变更」这类情况。
- 库备份：开启 WAL；每轮成功结束后把 bid.db 复制为 data/backup/bid_日期时间.db，滚动保留最近 14 份。bid.db 是「已通知」状态的唯一事实来源，损坏等于全量重发或历史丢失。

### 4.4 迁移与测试

- tools/import_seen.py：一次性导入旧 seen.json（标为 legacy 已通知），导入后跑一次 --baseline，避免首轮重复通知。
- pytest 覆盖：title_norm、dedupe_key、关键词正则、邮件落库门控（用假发送器）、国能E招 HTML 夹具解析。
- 关键词集中在 core/keywords.py：包含词、排除词；ASCII 词加边界，如 (?<![A-Za-z])AVC(?![A-Za-z])。
- 新旧并行 3 天（旧入口保留为 run_check_v1.py，只演练不发信），比对条目集合，差异可解释后切换。

### 4.5 自建测试 WEB（mock 站点）

适配器开发、调试和回归都对着本机 Docker 里的 mock 站点进行，不再每次访问真实站点，避开反爬和频率问题。
Phase 1 开头先搭骨架（约 2–2.5 天，含 Docker 环境），之后所有适配器工作都依赖它。

技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 运行方式 | Win11 + Docker Desktop（WSL2 后端）+ docker-compose | 环境一条命令重建，依赖固定在镜像里，不污染本机 Python；ego 和 run_check.py 仍在 Windows 主机上跑，只有 mock 在容器里 |
| 服务框架 | Python 3.12 + Flask + Jinja2，镜像基于 python:3.12-slim | 能做模板页、POST 接口、延迟和场景切换 |
| 数据与状态 | mockweb/sites/<站点>/ 下的 JSON + HTML 模板，由真站公开页面快照整理而来；场景状态放内存，重启即复位 | 页面结构贴近真站；不需要数据库或 redis（见下） |
| 端口 | 宿主机 127.0.0.1:18080 → 容器 8080 | 只对本机开放，不暴露到局域网 |
| 启停 | docker compose up -d --wait / down，封装为 scripts/mock.cmd；pytest 的 E2E 用例用 fixture 自动启停 | 测试不依赖手工起服务 |
| 环境切换 | config/sites.mock.json 把各站基址指向 mock；环境变量 BID_ENV=mock 选用它；浏览器空间用 test-* 命名 | 与 bid-*、dev-* 空间隔离，cookie 不串 |

docker-compose.yml 的组织

```yaml
services:
  mock-web:
    build: ./mockweb
    restart: "no" # 不随 Docker 自启，只在测试时手动起
    ports:
      - "127.0.0.1:${MOCK_PORT:-18080}:8080" # 必须显式写 127.0.0.1
    environment:
      MOCK_TODAY: "" # 空=真实今天；填 YYYY-MM-DD 冻结日期
    volumes:
      - ./tests/fixtures:/fixtures:ro # 真站快照，只读
    develop:
      watch:
        - action: sync+restart
          path: ./mockweb
          target: /app
        - action: rebuild
          path: ./mockweb/requirements.txt
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request as u; u.urlopen('http://127.0.0.1:8080/__health')"]
      interval: 5s
      timeout: 3s
      retries: 10
```

- mock-web 是唯一必需的服务。mockweb/Dockerfile 基于 python:3.12-slim，把 mockweb/ 复制进镜像的 /app，用 flask run --host 0.0.0.0 --port 8080 启动；容器内监听全部网卡，宿主机一侧由端口映射限制为回环地址。不开 FLASK_DEBUG：热更新统一交给 compose watch 的 sync+restart，同时避开 Werkzeug 交互调试器这个任意代码执行入口。
- 不需要数据库或 redis：状态只有当前场景开关和请求计数，单人使用，重启复位反而是优点；站点数据是只读的 JSON 和模板，要长期保留的场景写成 mockweb/scenarios/*.json 随仓库管理。
- mailpit：日常按需 docker compose --profile mail up -d 启用，测 SMTP 备用通道、查看告警和日报邮件样式；E2E（pytest -m e2e）强制启用该 profile 并把 SMTP 指向 mailpit，通知类断言全部落在 mailpit 收件上；agently 通道在 E2E 下用环境开关禁用或替换为假 CLI，以模拟演练 1 的「agently 与 SMTP 双失败」。webhook 接收桶 /__sink 内置在 mock-web 里，不单独起服务——webhook 通知暂不实施，仅作将来通道预留。
- 容器不需要出网，也不要挂载 data/、ego 配置目录、凭据文件或 docker.sock。
- 端口放在.env 的 MOCK_PORT（默认 18080）；仓库里只提交.env.example。

Windows + Docker Desktop 注意事项

- WSL2 后端：Win11 上 Docker Desktop 默认用 WSL2，需要 BIOS 开启虚拟化并已装好 WSL2。若公司电脑的策略禁用了虚拟化或 WSL，这套方案跑不起来，此时退回裸跑 Flask（保留 python -m mockweb 入口作为后备）。
- 文件挂载：代码在构建时复制进镜像，开发时靠 docker compose watch 同步，不依赖把 Windows 目录 bind mount 进容器——那条路径经过 WSL2 跨文件系统，速度慢，文件变更事件也不可靠。只读挂载的 tests/fixtures 体积小，可以接受。compose 里一律写相对路径./…，不写 C:\…；仓库留在 C:/work/ebid，不必搬进 WSL。
- 换行符：加.gitattributes，让 *.sh 等容器里要执行的文件强制 LF，避免 CRLF 导致容器内脚本报错。
- 开机自启：建议关闭 Docker Desktop 的「登录时启动」，容器统一 restart: "no"。测试前手动打开 Docker Desktop；E2E 的 fixture 发现 Docker 或 ego 任一没就绪时直接报错并提示，不静默跳过。
- 生产链路不依赖 Docker：任务计划程序 → run_check.py 全程不碰容器；tools/check_redline.py 增加一项检查，生产路径里不得出现 docker 调用。
- 资源：Docker Desktop 的 WSL2 虚拟机空闲时也占内存；在用户目录的.wslconfig 里设置内存上限（例如 2GB），给 ego 浏览器留足空间。
- 端口：Hyper-V 可能保留一段端口，冲突时用 netsh int ipv4 show excludedportrange protocol=tcp 查看，并改.env 里的 MOCK_PORT。配置里一律写 127.0.0.1，不写 localhost，避免解析到::1 带来的不确定性；绑定回环地址也不会弹出 Windows 防火墙提示。
- 许可：Docker Desktop 个人和小型企业通常免费，较大企业需要付费订阅；在公司电脑上用之前先确认。

开发调试流程

1. 首次：docker compose build，再 docker compose up -d --wait，等健康检查通过；访问 http://127.0.0.1:18080/__health 确认。
2. 日常改 mock（页面模板、站点数据、场景 JSON、Flask 代码）：另开一个终端跑 docker compose watch，改动自动同步进容器并重启 mock-web，几秒内生效。
3. 改 requirements.txt 或 Dockerfile：watch 会自动重建；没开 watch 就 docker compose up -d --build。Docker Desktop 版本太旧不支持 watch 时，也用这一条。
4. 只想切换场景：不用重启，运行时调 curl.exe "http://127.0.0.1:18080/__admin/scenario?site=chd&mode=empty"；/__admin/reset 全部复位为 normal。（PowerShell 里的 curl 是别名，要写 curl.exe。）
5. 看日志：docker compose logs -f mock-web；进容器排查：docker compose exec mock-web sh。
6. 跑回归：pytest -m e2e。fixture 先探测 Docker 与 ego 就绪（ego 用 ego-browser --version），再 docker compose up -d --wait --profile mail，设置 BID_ENV=mock 和 MOCK_BASE，用例结束默认 docker compose down；调试时加 --keep-mock 保留容器。
7. 收工：docker compose down。

与 config/sites.mock.json 的配合

- 文件里所有基址都写成 ${MOCK_BASE}/<站点>/，MOCK_BASE 默认 http://127.0.0.1:18080，由 core/config.py 加载时展开环境变量。端口只在.env 的 MOCK_PORT 和 MOCK_BASE 这两处出现，scripts/mock.cmd 启动时根据 MOCK_PORT 生成 MOCK_BASE，避免两处不一致。
- BID_ENV=mock 时加载 sites.mock.json，适配器的 URL 白名单只含 MOCK_BASE；生产加载 sites.json，白名单不含任何本机地址，由 check_redline.py 检查。
- ego 和 run_check.py 都在宿主机上跑，所以直接访问 127.0.0.1:18080，不需要进容器网络；容器也不会反过来访问宿主机。
- 分工：sites.mock.json 只描述「去哪里访问」，场景开关描述「mock 怎么响应」，场景通过 /__admin 接口切换，不写进 sites.mock.json。
- mock 环境下，run_check.py 先请求 ${MOCK_BASE}/__health，失败就直接退出并提示先启动 mock，避免误打到别处。

要 mock 的页面和接口

| 对象 | mock 内容 | 用来测什么 |
|---|---|---|
| 国能E招 | 三类公告（招标 001002 / 非招标 001003 / 变更 001004）的 moreinfo、2、3 页列表，链接与标题属性格式同真站；详情页 | 静态抓取的正则、翻页、关键词过滤 |
| 华电 | 外层页 + iframe 内搜索列表（iframepage4，ggbt 关键词参数）；iframe 可延迟加载；标题可带「…」截断 | waitFor* 替代固定 sleep、iframe 时序、标题清洗与去重键 |
| 大唐 / 犀维 | 同源页面 + 公开 POST JSON 接口（三类公告 × 关键词，分页） | page.fetch() 通道、接口字段映射 |
| 通用站点模板 | 由配置生成「列表页 + 详情页 + 可选站内搜索」 | Phase 2 每个新站先在 mock 里落地 |
| 登录页（Phase 3） | 账密页、图形验证码页、带 TTL 的会话 cookie、未登录跳转 | sessionAlive、relogin、handOff（见 6.4） |
| 通知接收桶 | 邮件落 Mailpit 容器（E2E 强制启用、SMTP 指向它）；/__sink/webhook 仅作将来通道预留（webhook 通知暂不实施），可按场景返回失败 | 重试、SMTP 备用、告警与日报内容 |

场景开关通过 /__admin/scenario?site=<站点>&mode=<模式> 切换（也可写 mockweb/scenarios/*.json）。所有 /__admin/* 与 /__sink/* 接口要求固定 token 参数（存 .env，脚本与用例从环境变量读取），防止本机其他进程或网页直接 GET 改场景、复位状态，污染正在跑的用例。数据可固定，发布日期按「今天」相对生成，用来测 FRESH_DAYS。

| 模式 | 行为 | 对应的用例 |
|---|---|---|
| normal | 正常列表，含若干 AVC/AGC 与无关公告 | 基线、去重 |
| empty | 列表为空 | raw_count 为 0 告警（0.2） |
| error5xx / timeout | 返回 500 或长时间不响应 | 单站失败隔离、连续失败告警、分站超时与进程清理（0.5） |
| layout_changed | 改变 DOM 结构或 URL 格式 | 改版检测与夹具单测 |
| truncated_titles | 标题被「…」截断且每轮不同 | title_norm 与 dedupe_key 稳定性 |
| changed_notice | 同一公告出现变更公告、截止时间变化 | 变更公告作为新事件 |
| poisoned | 标题含提示注入文字、控制字符、超长文本，详情含指向非白名单域名的链接 | 字段清洗、URL 白名单、红线 |
| session_expired / captcha | 会话到期、要求验证码（Phase 3） | 降级为公开采集、告警邮件、relogin |

接入各阶段的方式

- Phase 0：不依赖测试 WEB，先快速止血。
- Phase 1：开头搭骨架并覆盖现有 3 站，再重构适配器。tests/e2e/ 用 docker compose 起 mock、设 BID_ENV=mock，跑完整的 run_check.py，断言入库条目、通知内容和告警（通知断言落在强制启用的 mailpit 收件上，agently 通道用开关模拟失败）；把 Phase 0 的四项演练改写成自动化用例。E2E 会真实驱动 ego，较慢，用 pytest 标记 e2e 单独跑：每次改适配器后、发布前各一次。
- Phase 2：每个新站先录制公开页面快照，在 mock 里加对应站点，对着 mock 写适配器、补用例，最后只对真站做 1–2 次冒烟（见 5.2）。
- Phase 3：加登录与会话失效 mock（见 6.4）。

边界与安全

- mock 无法复现瑞数的动态反爬、真实网络延迟和真站改版，这些仍靠真站冒烟和运行时的 raw_count 告警覆盖；不要把「mock 全绿」当成「真站可用」。
- 快照只取公开页面内容，不放任何真实账号、密码、证书口令。
- 生产的 URL 白名单不得包含 127.0.0.1；tools/check_redline.py 增加一项检查：生产配置里不得出现 mock 基址。
- 红线不变：mock 的开发和调试可以借助 AI（人在场），生产定时任务仍只走确定性脚本。

## 5. Phase 2：逐站实测与按量接入

### 5.1 先实测，再动手（约 1 天）

用无痕窗口、不登录，逐站填表。实测对象共 9 站 = 8 个已注册平台（以 2026.10.23 凭据台账「黄标」8 行为准，文件在仓库根目录、受 gitignore 保护）+ 国能E招（v1 静态站，无账号）；大唐的公开采集通道为犀维网，与大唐同行评估。

| # | 平台 | 网址 | 公开列表可见 | 详情/附件需登录 | 站内搜索或接口 | 反爬形态 | 近 90 天相关公告数 | 发布节奏 |
|---|---|---|---|---|---|---|---|---|
| 1 | 华电 | chdtp.com | 待填 | 待填 | 待填 | 瑞数（v1 已知） | 待填 | 待填 |
| 2 | 大唐（公开通道：犀维 cweme.cn） | cdt-ec.com | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 3 | 中电设网 | cpeinet.com.cn | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 4 | 国网ECP2.0 | ecp.sgcc.com.cn | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 5 | 国网电工专区 | sgccetp.com.cn | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 6 | 国能e购 | neep.shop | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 7 | 华能 | ec.chng.com.cn | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 8 | 国家电投 | ebid.espic.com.cn | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 9 | 国能E招 | chnenergybidding.com.cn | 是（v1 已知） | 待填 | 无（v1 已知） | 无（静态站） | 待填 | 待填 |

### 5.2 接入顺序

按「公开可见 且 相关公告量大」优先，反爬越重越靠后。每站固定流程：

1. 在 dev-* 空间探索真站的页面与接口，访问量保持很小。
2. 保存公开页面快照到 tests/fixtures/<站点>/，整理后在 mockweb/sites/<站点>/ 建对应的页面与接口（见 4.5）。
3. 对着 mock 写适配器，补单测和 mock E2E 用例（含改版、空列表、报错等场景）。
4. 对真站只做 1–2 次冒烟验证，确认 mock 与真站一致，尤其是反爬环节，不在真站上反复调试。
5. 灰度：config/sites.json 中设 notify: false，只入库不发通知，观察 2 轮。
6. 打开通知，正式启用。

### 5.3 正文二次匹配（试点 1 站，1–2 天）

只匹配标题会漏掉「AVC 只是大项目一个子项」的公告。对标题含「改造、升级、技改、综合自动化、调度、涉网、监控系统」等词的公告（词表由你按业务调整），抓正文再做关键词匹配，命中记 match_source = body。每轮限量并加 2–5 秒随机间隔，请求量远低于人工浏览。

### 5.4 频率

默认每日 2–4 次，写进配置可调。不追求 2 小时一轮：投标窗口通常是几天到几周，频率翻倍只增加反爬风险和资源占用。

涉及文件：adapters/<站点>.mjs、config/sites.json、tests/fixtures/、docs/site_matrix.md（实测表）。

## 6. Phase 3：必须登录的站点（评估后再定）

### 6.1 决策门

对每个「登录才有增量」的站点回答三个问题，全部有数据才决定做不做：

1. 登录后比公开页多出多少有投标价值的 AVC/AGC 公告（近 90 天，邀请招标、供应商专区等）？
2. 会话寿命实测：登录后每 15 分钟探测一次，记录首次失效时间，持续 24 小时。
3. 人工介入频率与增量价值是否匹配？由你设阈值，例如每月多出 ≥ 1 条有价值公告。

不满足就不做；国网 Ukey 类站点若会话撑不过一个检查间隔，基本等于每次人工，默认不接入。

### 6.2 三种实施模式

- A. 账密自动填充：凭据用 Windows DPAPI 加密存于 data/secrets.dpapi，不进 git；Python 编排器解密，通过子进程环境变量传给适配器，读取后立即使用，日志过滤掉这些值。
- B. 验证码 / 手机证书（handOff，异步）：会话失效时不阻塞——该站降级为公开采集，发告警邮件，内容写明运行 scripts/relogin.mjs <站点>；你完成登录后，下一轮自动恢复。
- C. Ukey 站点：人工首登 + 每轮会话探测（sessionAlive），失效即告警，不做自动登录。

### 6.3 额外的安全要求

- 开启 BitLocker；ego 浏览器配置目录不进云盘、不进备份、不进 git。
- 已登录空间只允许访问适配器白名单 URL 前缀（见红线），适配器里不存在点击「报名 / 投标 / 提交」的函数。
- 登录类适配器的任何改动都必须人工 review 后再上线。

### 6.4 用 mock 测会话与登录流程

- 在测试 WEB 里提供登录页、图形验证码页和带 TTL 的会话 cookie（TTL 可配，例如 2 分钟），未登录或到期时跳转登录页。
- 用它验证 sessionAlive 探测、会话失效后降级为公开采集并发出告警、scripts/relogin.mjs 的 handOff 流程，以及重新登录后下一轮自动恢复。
- 真站的会话寿命（6.1 第 2 项）仍需实测，mock 的 TTL 只用来测流程，不代表真站。
- 只在通过 6.1 决策门、确定要做登录类站点时才建这部分，预计 0.5–1 天。

## 7. 风险与回滚

| 风险 | 对策 |
|---|---|
| 站点改版导致适配器失效 | raw_count 为 0 告警 + 夹具单测，改版只改单个适配器 |
| mock 与真站不一致，或无法复现瑞数反爬 | 每个新站对真站做 1–2 次冒烟；改版告警后重新录制快照并更新 mock；不把 mock 全绿当作真站可用 |
| 测试 WEB 被误当生产，或暴露到局域网 | compose 端口映射显式绑定 127.0.0.1（Docker 默认绑定所有网卡）、按需启动，生产链路不依赖 Docker；生产白名单不含 mock 地址，由 check_redline.py 检查；test-* 空间与 bid-* 隔离 |
| stdin 方式不支持跨文件 import | Phase 1 开头先 spike，备选拼接方案 |
| 并行期新旧双发 | 旧入口只演练不发信；切换前暂停旧定时任务 |
| ego 能力与文档描述不一致 | 本方案按文档描述假设成立，每项依赖 ego 的能力在对应阶段先小范围验证 |
| 电脑关机或注销导致漏跑 | 任务计划「错过后尽快运行」+ 日报缺失即信号 |
| ego 自动升级后 CLI 协议或行为变化 | 固定版本或延后升级；runs 表记录 ego 版本号；升级前先在 dev-* 空间验证再进生产 |
| ego 任务空间数量超预算（bid-*/test-*/dev-* 随站点增长） | 临时空间 finish({keep:false}) 回收；空间清单写入日报观测 |

回滚：每阶段一个 git tag；Phase 1 并行期保留 v1 入口；任一阶段出问题，可退回上一个 tag 并重新启用旧任务。回退到 v1 时，旧入口先跑一次 --baseline 重建 seen.json 再恢复正常调度，避免把 SQLite 里已通知的公告全部重发（import_seen 只有 v1→v2 方向，无反向导出）。

## 8. 建议的推进节奏

先做 Phase 0（约 1–1.5 天）并跑满 3 天，再启动 Phase 1，并在 Phase 1 开头先搭好测试 WEB 骨架（约 2–2.5 天，含 Docker 环境），之后的适配器重构和每个新站点都对着它开发。Phase 2 开头的实测表建议在 Phase 1 进行期间并行完成，它决定后面接几个站、接哪些，也决定 Phase 3 要不要做。
