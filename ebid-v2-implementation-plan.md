# 电力招投标监控系统 v2 实施方案（简化版）

基于《需求v2-重构与AI最佳实践征询》（现位于 old/）· 2026-10-24 起草 · 单人维护、Windows 11 本机、ego(lite) 浏览器。历经七轮外部评审回写后，于 2026-10-26 做第八轮**简化**。

**本版关键决策**：七轮评审使方案长出了大量"为评审而生的机制"（复杂度棘轮）。本版按"单人、单机、3 站、每日 2 轮"的实际规模砍掉 8 项，骨架不变——时间窗水位、字节锁、退出码、双 worktree、备份、watchdog、标定测试全部保留。被砍机制在真实需要时再建（见修订记录）。测试策略维持第二版定案：真站标定查询 + 已知答案夹具，不做 mockweb（目录封存）。

**修订记录（压缩版）**：R1–R3（2026-10-24）确立测试策略、时间窗、退出码、原子写、watchdog；R4–R6（2026-10-26）加深为 outbox 快照、跨源去重、shadow 编排、Schema 契约、金丝雀、sync 工具等；R7（2026-10-26）终审"有条件开工"并回写 worktree 隔离、锁策略、watchdog 口径、shadow 时序、容量 spike。**R8（本版，简化）**：砍 outbox/outbox_items（回到"发送成功才落库 + pending.json + 告警节流"）、publisher 跨源去重与 native_id_namespace（Phase 1 三站无跨源，dedupe_key=站点+类型+id）、revision_hash 字段合并（只比 deadline）、JSON Schema 契约与时间三元组（文档示例 + 单测断言代替）、周金丝雀（改适配器后跑标定 + 月度抽检已覆盖）、sync_schedule.py（doctor 校验触发器代替）、shadow 切换编排（v1_sent.jsonl/交集 baseline/错峰；并行期人工比对 + 切换日三步 runbook 代替）、coverage_gaps 表与 --backfill（日报一句话 + --from 手动窗口代替）。保留 R7 全部骨架项。

## 1. 目标、范围、红线

- 目标：尽早、可靠地发现各电力集团的 AVC/AGC 招标公告。可靠性目标：任何单点故障（改版、抓取失败、任务未跑、邮件双通道故障）在 24 小时内以告警或日报异常可见；「日报没到」即人工介入信号。本机整体不可用为已接受残余风险。
- 范围：先稳住 v1（3 站），再按实测扩展；登录类最后评估。
- 红线：生产定时任务只走确定性脚本；链路（任务计划 → run_check.py → ego-browser nodejs）中无任何 LLM Agent 命令行；AI 只在人在场时用 dev-* 未登录空间参与开发。
- 公告内容一律不可信数据：只抽白名单字段、限长、清洗控制字符；URL 白名单前缀强制；不做任何「报名/投标/提交」操作。
- 上线自检：check_redline.py 扫描 run_check.py、core/、adapters/、_lib/common.mjs，发现 agent CLI 调用或非白名单域名即失败（agently-cli 是确定性邮件 CLI，显式白名单）；生产 URL 白名单不含 127.0.0.1；适配器改动人工看 diff 后上线。邮件正文：标题/机构名按文本节点 HTML 转义，URL 入 href 前校验 scheme（§4.5 投毒全链路测试覆盖）。

## 2. 阶段总览

| 阶段 | 内容 | 工作量 | 退出标准 |
|---|---|---|---|
| Phase 0 | 修 v1 三坑 + 任务计划 + 预检/手册 | 3–4 天 | 演练全过（含强杀锁恢复），无人值守 3 天 |
| Phase 1 | 适配器接口、SQLite、标定回归（原 3 站） | **4–6 天**（含 spike 容量测量；并行观察 3 天另计） | 单测+标定全绿，并行 3 天一致后切换 |
| Phase 2 | 逐站实测接入 | 实测 1 天 + 每站 1.5–2 天 | 每站灰度 ≥3 天 |
| Phase 3 | 登录类评估 | 决策 0.5 天；实施每站 2–4 天 | 过决策门才做 |

每阶段打 git tag。

## 3. Phase 0

**0.0 凭据清理（施工门禁）**：改密码/证书口令（按已泄露处理，先于一切）、仓库转私有、清 git 历史、凭据三副本收敛为一份加密。未完成不开工 0.1 之后任何代码。

### 0.1 修「邮件先落库」

只有发送成功才落库；agently 两段式调用的成功谓词 = 两段 returncode 均为 0 且第二段结构化解析 ok===true（非子串匹配），任一不满足即未确认。失败走 SMTP 备用；双失败 → 待发公告与告警落盘 data/alerts/pending.json + Windows 桌面通知，退出码 3，下一轮优先补发（pending 与"重新判新"按 dedupe_key 合并去重，每键一封）。告警类邮件同样"成功才前移 last_alert_at"（防被 24h 节流吞掉）。SMTP 授权码即用 DPAPI 加密存 data/secrets.dpapi。

### 0.2 修「静默失败」

每站每轮记 ok / raw_count（过滤前总数）/ 命中数 / 错误。告警规则：单站连续失败 ≥2 轮（主题固定，24h 至多 1 封）；恢复通知；ego 整体无产出告警。**改版判据分站**：列表站（国能、华电）此前有数据而 raw_count=0 → 疑似改版；时间窗站 = 7 天宽窗 raw_count 为 0 **或** 响应结构校验失败，任一即告警（窄窗安静日空结果是正常的，不告警）。退出码：0=正常；2=站点告警类；3=邮件双失败；4=等锁超时顺延（deferred）。并存取最大优先级（3>4>2）。每轮追加写 data/runs.jsonl（时间、退出码、trigger、各站结果、ego_version、code_version——读取容忍末尾半行）；state.json（失败数、告警时间、last_success_at）一律「临时文件+os.replace」原子写（遇杀毒占用短重试）。

### 0.3 补「心跳」

每日日报（08:30 轮后，固定主题，无新公告也发）：各站成功次数/抓取数/新增数、计划 vs 实际轮次、未决缺口、pending 未决告警。独立 watchdog 任务（每小时、不依赖 ego）：上一个应触发时刻（读 config/schedule.json，不硬编码）过后 3 小时仍无成功运行即告警（24h 节流）。**「成功」口径**：仅 trigger=main、prod 模式、全站跑完、退出 0 或 2——手动/replay/宽窗成功不算（活着≠主链路活着）。日报"实际轮次"同口径。

### 0.4 任务计划与生产隔离

- 触发器：main 08:30/14:30、wide 09:40、watchdog 每小时（三类时点写 config/schedule.json，手工建任务，doctor 校验一致）。
- **生产跑独立 worktree C:/work/ebid-prod**（只检出阶段 tag）；runner 启动校验 worktree 干净且 code_version 与 tag 相符，否则拒跑并告警。开发树不进任务计划。
- 仅登录时运行、允许唤醒、错过后尽快运行、不并行新实例；上线前验证 ego 会话要求。
- 失败不设任务计划层重试（重试在 runner 内；任务计划重试=整轮重打反爬站）。main 任务上限 45 分钟。
- 启用前先暂停 Claude 应用里的旧 avc-agc-bid-watch。

### 0.5 进程超时与锁

Popen + 超时 taskkill /T /F 清进程树。主轮总超时 40 分钟 = 采集 ≤28（分站 4 分钟，超时跳站并告警）+ 通知尾部 ≥12（通知优先于采集）。09:40 wide 任务上限 80 分钟（等锁不计入）。**run.lock 字节锁**（msvcrt.locking，进程死自动释放；锁内记 pid/trigger/开始时间，持锁超上限告警）：定时类等锁 20 分钟→仍败记 deferred 退出 4、下一轮时间窗自动补做；manual 立即失败；watchdog 抢锁=主链路活着，顺延下小时。

### 0.6 手动监控

`run_check.py` 手动跑：默认全轮；`--site <站>` 单站、`--kw <词>` 临时关键词、`--from <起> --to <止>` 手动时间窗补查（时间窗机制天然支持，取代专用 backfill 工具）。默认不发邮件（新发现保持待通知，`--notify` 立即发），写 runs 标 manual。用途：截标加查、改适配器即时验证、漏公告补查、7 天外缺口人工补抓。

### 0.7 预检与手册

tools/doctor.py（一条命令：python/依赖、ego 探测、任务触发器==schedule.json、DPAPI 可解密、磁盘余量、时钟）；docs/runbook.md（安装、启停改触发、手动轮、日志位置、备份恢复、常见故障对照）。涉及文件：run_check.py、data/state.json、config/schedule.json、tools/doctor.py、docs/runbook.md、.gitignore。

退出标准：① agently+SMTP 双失败不丢公告；② 改错 URL 两轮告警、改回恢复通知；③ 日报每天到达；④ 无人值守 3 天；⑤ 强杀后重跑无锁残留；⑥ 施工产物核对（schedule.json/doctor/runbook/日志清理）；⑦ 无 Docker 单测全绿（假发送器门控、pending 合并、原子写故障注入、watchdog 口径）。

## 4. Phase 1

### 4.1 目录结构

```
ebid/ # 开发树 C:/work/ebid；生产 worktree C:/work/ebid-prod（§0.4）
run_check.py # 薄入口: main/manual/wide/watchdog 统一进锁
core/ # config, db, dedupe, runner, notify, report, keywords
adapters/ # 每站一个 (.mjs 浏览器站 / .py 静态站)
_lib/common.mjs # 导航白名单、等待、清洗、输出
config/sites.json # 站点开关/空间/notify/频率/实测容量页数定标
config/schedule.json # main/wide/watchdog 触发时点
tools/ check_redline.py · doctor.py · import_seen.py · export_seen.py
docs/ runbook.md · site_matrix.md
data/ # bid.db、state.json、runs.jsonl、run.lock、alerts/、backup/、secrets.dpapi、logs/、out/<run_id>/
tests/ unit/ · e2e/ · fixtures/(含 replay/) · calibration/
ebid-v2-mockweb/ # [封存]
```

开工 spike（约 1.5 天）：① 验证 ego-browser stdin 方式相对 import 可用（否则拼接方案）；② 容量测量——各站日公告量、每页条数、能否服务端关键词收窄，实测值写入 sites.json 定标页数（§4.5 的 5 页/30 页只是缺省兜底）。

### 4.2 适配器输出约定（每站一个文件，故障隔离）

```json
{ "site": "华电", "run_id": "r20261026-0830-x7k2", "ok": true, "error": null,
"raw_count": 20, "exhausted": true, "page_limit_hit": false, "stop_reason": "short_page", "pages_fetched": 2,
"items": [ { "title": "…", "notice_type": "招标公告", "published_date": "2026-10-20",
"url": "…", "native_id": "…", "deadline_raw": "…", "deadline": "2026-11-05T17:00:00+08:00",
"org": "", "project_no": "", "channel": "dom" } ]}
```

格式即契约（单测断言必填字段与类型；适配器增至 5 个以上再升格 JSON Schema 文件）。单条 item 异常跳过并记 rejected 原因，不静默不整站失败；顶层解析失败才算整站失败。输出写 data/out/<run_id>/<站点>.json（runner 注入 run_id，校验归属本轮、拒收陈旧文件）。翻页元数据（exhausted/page_limit_hit/stop_reason/pages_fetched）必填——水位推进只认显式字段。校验异常的轮次不推进覆盖水位。

### 4.3 SQLite（4 张表）

| 表 | 关键字段 |
|---|---|
| notices | id、site、native_id、title、title_norm、notice_type、published_date、url、deadline_raw、deadline、org、project_no、first_seen、matched_keywords、dedupe_key（唯一索引）、notified_at、last_notified_deadline |
| runs | id、started_at、finished_at、result、run_mode、trigger、mail_status、ego_version、code_version |
| site_runs | run_id、site、ok、error、raw_count、matched_count、new_count、duration_s、coverage_from、coverage_to |
| site_state | site、consecutive_failures、last_ok_at、last_alert_at、last_success_at（全局） |

- dedupe_key = 站点 + 类型 + (native_id 或 sha1(title_norm+日期))；native_id 优先（URL/接口提取，免疫标题截断）。变更公告类型进键=新事件。
- notified_at 空=待通知；同键只比 deadline（结构化字段中唯一必须通知的变更；org/编号变化走变更公告兜底），变化即重发（主题标「信息变更」）并更新 last_notified_deadline。Phase 2 若实测发现字段合并需求再议。
- 备份：VACUUM INTO data/backup/bid_日期时间.db（不直接拷文件），每日 09:40 任务执行、独立于宽窗成败，保留 14 份，integrity_check，验收前恢复演练一次。PRAGMA user_version 标记结构版本，迁移单事务+迁移前备份，旧代码遇高版本拒启动。runs/site_runs 保留 400 天。
- 写库唯一入口经 run.lock；import_seen/export_seen 等工具同样先取锁。

### 4.4 迁移与切换

- import_seen.py：old/data/seen.json 导入并转换 v1 键 → v2 键（无 native_id、标题可能截断，无法普遍映射的进异常清单人工处理，只列 FRESH_DAYS 内，更老忽略）；**禁笼统 --baseline**；导入后差集正常送出，个别已人工处理过的 --mark-notified。export_seen.py：回退导出（notified_at 非空的键尽量还原 v1 键格式，还原不了的进异常清单）。
- 单测（无网络）：title_norm、dedupe_key、关键词正则、邮件门控（假发送器）、pending 合并、原子写故障注入、watchdog 口径、各站夹具解析。
- --replay：读 tests/fixtures/replay/ 的适配器输出夹具 + 假发送器，演练 1/2 自动化；注入固定 run_id、跳过修改时间校验、强制临时 data 目录。
- 关键词：core/keywords.py 配置表（全称/简称/全半角/关联叫法），Phase 1 只匹配标题，宁可误报；每月人工抽检召回。
- **并行与切换（runbook 三步）**：并行 3 天，V1 照常生产发信，V2 以 notify:false 跑 shadow、日报列「将通知清单」，人工比对两侧（差异解释清楚才切）；切换日 ①import_seen 导入 ②人工核一遍 V2 待发清单 ③V2 置 notify:true、前两轮逐封核对。切换窗口 V1 发过的少量公告可能被 V2 重发一次——宁重勿漏，已接受。

### 4.5 真站标定回归

**原理**：真站历史公告不改写。历史时间窗圈定已知公告=期望答案；回归时同参数请求真站断言抽取一致——验证的就是真站本身。

**时间窗统一参数（生产 24h / 测试 N×24h）**：时间窗站（大唐 cdt-ec、犀维，及 Phase 2 多数平台）生产按「发布时间 ∈ [start, now]」取数，不抓默认列表页：

- 起点 start = max(now−7d, min(now−24h, last_ok_at−1h 重叠))——漏跑自动补齐、回看有上限；超 7 天缺口不再自动追赶，日报一句话列出直到 --from 手动补查。
- last_ok_at 仅当本轮「翻页穷尽且未撞上限」才前移；触顶不动、下轮重试。
- 翻页到穷尽（空页/短页停）；页数上限按窗长折算（缺省每 24h 5 页+绝对 30 页，**以 §4.1 实测定标**）；撞限即停+告警+不前移。列表站（国能、华电）常规 K 页=设计覆盖算穷尽；漏跑补跑加深到 10 页仍未穷尽才算触顶。
- 每日 09:40 宽窗任务对时间窗站加跑 7 天宽窗兜底（去重吸收重复）。

无时间查询站点抓默认列表页，漏跑时加深翻页并记日报。**生产窄窗先验证**：BID_NOW 可注入，标定时对已知公告前后各构造 24h 终点窗断言命中（边界闭合、时区、时钟偏差）。**测试开关隔离**：BID_NOW/agently 开关仅测试模式可读，生产读到即退出；--replay 强制临时 data 目录。

**标定手段**：大唐=more.jsp 时间起止（窗例 2026-06-01~06-30 含阳城电厂 AGC/AVC/PMU 公告）；犀维=getList startDate/endDate；华电=ggbt 长关键词圈定；国能=结构断言+夹具单测。标定文件 tests/calibration/<站>.json（参数+期望条目+期望 raw_count）；页面快照 tests/fixtures/<站>/。

**无法向真站点播的场景全下沉夹具单测**：空列表/报错/超时/改版/截断/投毒（全链路：投毒夹具→适配器→清洗→邮件转义断言）。

**执行**：pytest -m e2e；每站 1–2 次请求，改适配器后与发布前各一次；E2E 前探测 ego 就绪；强制临时 data+假发送器+dev-* 空间。SMTP 断言用进程内假接收器（aiosmtpd）。标定漂移=先甄别站点行为还是回归，重录并注明。改适配器后必跑标定 + 月度人工抽检（金丝雀独立机制已并入这两条）。mockweb 封存不动。

### 4.6 验收

单测全绿；3 站标定绿；备份恢复演练过；并行 3 天差异解释清楚并按 runbook 三步切换；旧入口转 run_check_v1.py 归档；目录树 Phase 1 产物齐全。

## 5. Phase 2

### 5.1 实测先行（1 天）：9 站公开可见性/反爬/公告量填表（docs/site_matrix.md）。

### 5.2 每站流程：dev-* 探索 → 录夹具+标定 → 夹具单测写适配器 → 标定回归 → 灰度（notify:false ≥3 天，覆盖一次宽窗、一个夜间空档、一次故障注入）→ 显式 --baseline → 开通知前两轮逐封核对。未接入/暂缓站维护未覆盖清单，月巡检。**跨源重复先接受**：Phase 2 接 cdt-ec 后若与犀维重复通知同一公告，先人工忽略，实测重复量大再引入合并（本版砍掉的 publisher 机制按此触发条件回归）。

### 5.3 正文二次匹配（试点 1 站）：标定周对窗口内全部新公告抓正文实测召回，再定预筛；命中记 match_source=body；正文哈希（content_hash）随试点记录，范围变更通知视实测价值决定。

### 5.4 频率：每日 2 轮（08:30/14:30），最坏 18h、平均 7.5h（R5 已签认放松）；截标加查用 §0.6 手动轮；随机间隔 2–5 秒不变。

## 6. Phase 3：登录类（过决策门才做）

决策门三问：登录增量（90 天）？会话寿命实测（24h 每 15 分钟探测）？人工介入频率可接受？不满足不做。模式：A 账密自动填充（DPAPI）；B 验证码 handOff 降级+告警+人工重登；C Ukey 人工首登+每轮探测。安全：BitLocker、ego 配置目录不入云/git、登录适配器人工 review、白名单前缀。会话流程在真站低频验证，不建 mock。

## 7. 风险与回滚

| 风险 | 对策 |
|---|---|
| 站点改版 | §0.2 分站判据；改版也令标定失败；改版只改单适配器后重录夹具标定 |
| 时间窗/翻页参数拍脑袋 | §4.1 容量测量定标；触顶告警兜底 |
| 补跑死循环/缺口 | 等锁 20min→deferred 自动补做；超 7 天缺口日报可见 + --from 手动补查 |
| 切换重发风暴 | import_seen + 人工核待发清单；少量重发已接受 |
| 跨源重复通知（Phase 2） | 先人工忽略；实测量大再引入合并机制 |
| 字段变更漏通知（org/编号） | 只比 deadline 是有意取舍；此类变化走变更公告（类型进键）兜底 |
| ego 升级破坏 CLI | 固定版本；runs 记版本；先 dev 验证 |
| 漏跑/关机 | 错过尽快运行 + 日报轮次对比 + watchdog |
| stdin import 不支持 | spike 先行，拼接备选 |

回滚：每阶段一 tag；回退 v1 用 export_seen 反向导出（best-effort 映射，notified_at 空的不导出——v1 首轮自动补发）；信息变更类会再发一次，可接受。

## 8. 推进节奏

1. C1/C2 凭据门禁（改密码→转私有→清历史→收敛副本）。
2. Phase 0（3–4 天）+ 3 天演练。
3. Phase 1（4–6 天）：spike+容量 → SQLite/适配器 → 夹具标定 → 全绿 → 并行 3 天 → 切换。
4. Phase 2 实测表可并行做。
5. 本版为简化定稿；被砍机制按 §7 触发条件回归，不再泛化评审。

## 9. 原需求追踪矩阵

| 原需求 | 决策 | 阶段 | 备注 |
|---|---|---|---|
| R1 8 平台全接 | 实测定接入数，未覆盖清单月巡检 | 2 | 范围缩减签认 |
| R2 登录分级 | 过决策门才做 | 3 | — |
| R3 DPAPI | 不变，提前至 Phase 0 | 0/3 | — |
| R4 可靠性 | 全保留（waitFor*/隔离/告警/熔断） | 0/1 | — |
| R5 ≤2h | 放松为每日 2 轮，最坏 18h | 已签认 | — |
| R6 通知不重复 | 发送成功才落库 + native_id 去重 | 0/1 | 跨源合并推迟至实测需要 |
| R7 适配器模式 | 统一 JSON 约定 + 夹具单测 | 1 | Schema 文件推迟 |
| R8 结构化报告 | runs/site_runs + 日报 | 0/1 | — |
| Q10 快照/检索 | 顺延，留扩展位 | 待定 | content_hash 随 §5.3 试点 |
