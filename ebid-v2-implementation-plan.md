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

- 每日固定一封日报（建议 08:30 那一轮结束后发），主题固定，无新公告也发。内容：各站 24 小时内成功次数、抓取总条数、新增数、最近一条相关公告的日期、计划轮次/实际成功轮次（漏跑可见）。
- 独立 watchdog：再建一个不依赖 ego 的任务计划，仅检查「距上次成功运行（由 runs 表推导）是否超过 20 小时」，超过即发告警邮件（阈值须大于 2 触发器下 18h 的正常最长空档）。机器整体不可用时 watchdog 同样失效，最终兜底是「日报没到即人工介入」。外部 dead-man's switch 类服务与不上云约束冲突，不引入。
- 「没收到日报」本身就是系统异常的信号（任务计划挂了、电脑关机、邮件通道坏了）。不依赖云端 ping，符合「不上云」约束。

### 0.4 迁移到任务计划程序

- 触发器：08:30 与 14:30 两个。
- 运行条件：仅当用户登录时运行（ego 是桌面应用，注销后无法运行，锁屏没问题）；允许唤醒计算机；错过后尽快运行；不并行启动新实例。
- 上线前验证 ego 是否必须在登录会话中运行（决定「无论用户是否登录都运行」是否可用）；漏跑可见性靠日报的计划/实际轮次对比。
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
config/sites.json # 生产站点开关, space 名, 是否通知, 检查频率
ebid-v2-mockweb/ # 测试 WEB 子目录: 规划文档 + 全部实现 (2026-10-24 已建成, 提交 1ae2229)
  mockweb/ # 自建测试 WEB (见 4.5): app.py、sites/、scenarios/、Dockerfile、requirements.txt、.dockerignore
  docker-compose.yml # mock-web (+ 可选 mailpit), 相对路径以本目录为根
  config/sites.mock.json # 测试环境: 基址用 ${MOCK_BASE}; BID_ENV=mock 时 core/config.py 从此处加载
  scripts/mock.cmd # up / mail / down / watch / logs / scenario 的封装
  tests/ # unit/ (mock 单测) + fixtures/ (真站快照); e2e/ 随 Phase 1 core 补
  .env.example .gitattributes # 真实 .env 不入库
data/bid.db data/out/<站点>.json data/logs/ # 运行时数据
tests/e2e/ tools/check_redline.py # e2e 挂架与红线自检属 Phase 1 core 工作, 在仓库根
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
- 库备份：不直接拷文件（WAL 未 checkpoint 时拷 .db 会丢最近写入，写入期间拷贝也可能得到损坏副本），只走 SQLite 自身机制——VACUUM INTO 'data/backup/bid_日期时间.db'（目标文件须不存在，得到压缩后的一致快照）或 sqlite3.Connection.backup()。每轮成功结束后执行，滚动保留 14 份；备份后对副本跑 PRAGMA integrity_check；Phase 1 验收前做一次「从备份恢复」演练。WAL 非必需（单用户、单写入进程），不开。bid.db 是「已通知」状态的唯一事实来源，损坏等于全量重发或历史丢失。
- 详情快照与全文检索 Phase 1 不做（§5.3 只匹配不入库），notices 表留扩展位（如 content_hash / body_path 列），需求 Q10 顺延。

### 4.4 迁移与测试

- tools/import_seen.py：一次性导入 old/data/seen.json（v1 归档时已移入 old/，标为 legacy 已通知），导入后跑一次 --baseline，避免首轮重复通知。
- pytest 覆盖：title_norm、dedupe_key、关键词正则、邮件落库门控（用假发送器）、国能E招 HTML 夹具解析。
- 关键词集中在 core/keywords.py：包含词、排除词；ASCII 词加边界，如 (?<![A-Za-z])AVC(?![A-Za-z])。关键词做成配置表：覆盖全称/简称（自动电压控制/自动发电控制）、全半角与大小写、业务关联叫法（调频、涉网等，按行业习惯补全）；标题与正文都匹配（§5.3 已抓正文）；notices 表记录命中词便于复盘；宁可误报不漏报；每月人工抽检一次——在各站内手工检索关键词，与监控命中结果比对，评估召回。
- 新旧并行 3 天（旧入口保留为 run_check_v1.py，只演练不发信），比对条目集合，差异可解释后切换。

### 4.5 自建测试 WEB（mock 站点）

完整规划已独立为 [ebid-v2-mockweb.md](ebid-v2-mockweb/ebid-v2-mockweb.md)（技术选型、compose 组织、接口与 token 约定、mock 对象与场景模式、Windows+Docker 注意事项、调试流程、各阶段接入、边界与安全）。要点：

- 本机 Docker（WSL2）里的 Flask mock 站点，127.0.0.1:18080 仅回环；公司策略禁用时退回裸跑 Flask。
- 适配器开发、调试、回归全部对着 mock，真站只做 1–2 次冒烟；不把「mock 全绿」当「真站可用」。
- E2E 强制启用 mailpit 并把 SMTP 指向它，通知断言落在收件上；agently 通道用开关模拟失败（演练 1 自动化的前提）。
- /__admin/*、/__sink/* 带固定 token；生产白名单不含 mock 基址，生产路径不出现 docker 调用（check_redline.py 检查）。
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

范围变更（R1 的「8 平台全接入」改为按公告量实测决定、登录类默认不做）：未接入与暂缓站点维护在 docs/site_matrix.md 的「未覆盖清单」，每月人工巡检一次，让覆盖缺口可见；若 AVC/AGC 公告实测集中在登录类站点，回到 §6 决策门重评。

### 5.3 正文二次匹配（试点 1 站，1–2 天）

只匹配标题会漏掉「AVC 只是大项目一个子项」的公告。对标题含「改造、升级、技改、综合自动化、调度、涉网、监控系统」等词的公告（词表由你按业务调整），抓正文再做关键词匹配，命中记 match_source = body。每轮限量并加 2–5 秒随机间隔，请求量远低于人工浏览。

### 5.4 频率

频率基线（已接受，较需求 R5 的 ≤2h 放松）：每日 2 轮（08:30/14:30），最坏延迟 18h、平均约 7.5h=(6²+18²)/(2×24)。夜间空档是主因：若要压缩，08:30/12:30/16:30 最坏 16h，五点最坏 12h，达到 ≤2h 需每日 ≥12 轮且覆盖夜间——与并发预算、反爬、维护成本权衡后暂不做。临近截标的单站调高频率已留配置口子；触发点增减须同步修改任务计划。投标窗口通常是几天到几周，频率翻倍只增加反爬风险和资源占用。

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
