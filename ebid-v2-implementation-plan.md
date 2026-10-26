# 电力招投标监控系统 v2 实施方案

基于《需求v2-重构与AI最佳实践征询》（现位于 old/）与可行性评估 · 2026-10-24 · 单人维护、Windows 11 本机、ego(lite) 浏览器；审阅问题清单见 ebid-v2-plan-review-revised.md（终版）

**本版（2026-10-24 第二版）关键变化：放弃自建测试 WEB（mockweb），测试策略改为「真站标定查询 + 已知答案夹具」——利用各站自带的发布时间/关键词查询，用历史时间窗圈定一组固定不变的已知公告作为回归基准（§4.5）。** mockweb 相关内容（§4.5 原文、E2E 的 compose/mailpit profile、BID_ENV=mock、sites.mock.json、test-* 空间）全部取消；已建成的 ebid-v2-mockweb/ 目录封存不再维护。审阅清单中 E1–E6、B3 随方案作废；**A6（目录布局）是已解决而非作废**（§4.1 目录树已按实际更新）。C1/C2/C3 三项人工事项不变。

**修订记录**：2026-10-24 当日三轮评审回写——第一轮（A/E 两类 14 项，提交 53e12cf）；第二轮（时间窗防漏/退出码分离/Phase 0 自洽/runner 重放/DPAPI 提前/窄窗验证等 11 项）；第三轮（本轮）：时间窗规则补齐（last_ok_at 前移条件、按窗长折算的页数上限+绝对上限 30 页、7 天回看上限、静态站漏跑加深翻页）、改版判据分站（时间窗站用 7 天宽窗+结构校验，安静日不误报）、内容变化只比 deadline（通道间标题截断不误判）、测试开关生产隔离（BID_NOW/agently 开关仅测试模式、--replay 强制临时 data 目录）、Phase 0 补 runs.jsonl 与原子写、watchdog 节流与成功定义、pending 合并去重、退出码 2/3 并存取 3；新增周金丝雀与本机桌面告警。第四轮（2026-10-26 外部终评回写）：迁移禁笼统 baseline、回滚改 export_seen 反向导出、新增 coverage_gaps 缺口表与 --backfill、通知状态机字段定案（dedupe_key 唯一索引/notified_at/last_notified_deadline）、并行期明确 V1 生产 V2 shadow、文件锁改字节锁、正文匹配统一移 Phase 2、灰度 ≥3 天且不补发历史、目标改可验证表述、schedule.json+sync_schedule.py 防调度漂移、工时上调（Phase 0 2–3 天/Phase 1 8–12 天）、凭据治理定为施工门禁。第五轮（2026-10-26 第二次外部评审回写）：统一 outbox 表（所有邮件类型共用「成功才确认」，撤销上轮「不预设」决定）、适配器 JSON Schema 严格契约（schema_version/必填枚举/时间三元组/单条隔离不静默/校验失败不推水位）、公告身份拆分 publisher/source_site（大唐官网与犀维跨源只通知一次）、agently 两段式成功谓词定案（两段 returncode+结构化 ok）、正文匹配试点改为全窗实测召回再定预筛、revision_hash 取代只比 deadline、超时预算端到端拆分并拆出宽窗+备份独立任务、红线收紧（扫描范围含 _lib 与 relogin、运行时 origin/路径/方法授权、邮件逐字段转义、投毒全链路测试）、金丝雀改全站轻检+深度轮换 ≤30 天、新增 §9 原需求追踪矩阵。第六轮（2026-10-26 第三次外部评审回写，一致性修订——评审结论：方案接近可施工，本轮后冻结功能范围进入施工）：shadow 切换 baseline 限定「有 V1 已发送证据的交集键」、V2-only 条目人工复核、有效项切换后补发、未解释差异不通过切换验收；outbox 行持久化完整邮件快照（subject/body/recipient/created_at）＋outbox_items 关联公告与 revision_hash，重试发同一快照不重拼；发送与写库收敛唯一组件，watchdog 不独立发信写库、经同一入口同一字节锁；seen 迁移建 legacy_seen_map 映射表，回滚导出优先用映射、无法映射进异常清单不静默造键；native_id 保留命名空间，跨源合并须实测同源或显式映射；revision_hash 宣称范围收敛为结构化字段，招标范围变化检测移 Phase 2 content_hash；09:40 补锁忙等待/顺延/幂等规则并从主轮删除备份预算；适配器输出带 run_id 防陈旧读并增 exhausted/page_limit_hit/stop_reason/pages_fetched；Phase 0 全量原子写＋无 Docker 自动化单测；runs 表补 run_mode/ego_version/code_version/config_hash/effective_options，SQLite 定 PRAGMA user_version/事务迁移/迁移前备份/各表保留策略；目录树补全施工产物（schedule.json、sync_schedule.py、import_seen/export_seen、site_matrix、doctor、runbook）并纳入验收；runner 自建 UTF-8 文件日志＋30 天清理，Phase 0 增预检 doctor 与 runbook（工时 3–4 天）。第七轮（2026-10-26 冻结版终审，结论「有条件开工 Phase 0」——条件已全部回写）：生产独立 worktree ebid-prod＋runner 拒跑脏树（P1-1）；分触发类型锁策略，main 等锁 20 分钟→deferred 退出码 4，锁文件记 pid/trigger 防挂死（P1-2）；watchdog 与日报「成功」口径收严为 main+prod+全站+退出 0/2（P1-3）；revision_hash 入库前字段级合并、空→有值算补全不通知、哈希去掉已含于 dedupe_key 的字段（P1-4）；outbox_items 唯一约束、先重试旧行再建新行、快照 expires_at、恢复通知次序、cancel/requeue 工具（P1-5）；import_seen 提前至 shadow 开始时、V1 增 v1_sent.jsonl 发送证据、baseline 按 URL/native_id 交集、切换日只做三步并检查 pending（P1-6）；容量测量并入 Phase 1 开头 spike、页数参数实测定标、列表站常规 K 页不算触顶（P1-7）。P2/P3 同批：09:40 上限 80 分钟（等锁不计入）、备份独立于宽窗成败、replay 夹具定址 tests/fixtures/replay/ 并注入 run_id、写库工具一律取锁、legacy 异常清单限 FRESH_DAYS、Phase 0 退出标准增第 7 条单测、content_hash 归位 §5.3 与 §9、shadow 错峰 08:50/14:50、schedule.json 覆盖 main/wide/watchdog 三类、runs.jsonl Phase 0 即带版本字段并容忍半行、示例 JSON 与目录树补全。

## 1. 目标、范围、红线

- 目标：尽早、可靠地发现各电力集团的 AVC/AGC 招标公告。可靠性目标用可验证表述：任何单点故障（站点改版、抓取失败、任务未跑、邮件双通道故障）在 24 小时内以「告警邮件或日报异常」的形式可见，「日报未按时到达」本身即人工介入信号。本机整体不可用（关机/断电，watchdog 与主链路同亡）为已接受残余风险，系统自身无法覆盖，只能靠人发现日报没来。
- 范围：先稳住 v1（3 站），再按实测结果扩展；登录类站点放最后评估，不为扩展而扩展。
- 红线（贯穿所有阶段）：生产定时任务只走确定性脚本，AI 不驱动任何已登录的浏览器会话。
- 生产链路只有一条：任务计划程序 → run_check.py → ego-browser nodejs < adapters/…。链路中不出现任何 LLM Agent 命令行（Claude Code、Codex、Gemini CLI 等）。
- AI 只在人在场时参与开发：写、改适配器，分析页面结构；使用 dev-* 命名的未登录空间，不碰 bid-* 生产空间。
- 公告页面内容一律视为不可信数据：适配器只抽取白名单字段，限制长度并清洗控制字符，绝不把页面文字拼进脚本或命令。
- 公共库封装导航函数，强制 URL 前缀白名单；不实现任何「报名 / 投标 / 提交」类操作。该保证分两层：代码层不存在此类函数 + 运行时按解析后的 origin＋路径＋HTTP 方法授权，且每次重定向后重新校验（防 30x 跳到提交端点）。「即使会话有权限也绝对做不到」的强表述废弃——静态声明证明不了运行时行为。
- 可选的 AI 摘要（Phase 2 之后再议）只处理已抽取的纯文本：无工具、无浏览器，失败即回退原文，输出只用于邮件文案，不参与「是否通知」的判断。
- 上线自检：tools/check_redline.py 扫描 run_check.py、core/、adapters/，**以及 _lib/common.mjs（实际封装导航的公共库）与 scripts/relogin.mjs（Phase 3 登录脚本）——红线最该覆盖的两个文件**，发现 agent CLI 调用或非白名单域名即失败；生产 URL 白名单不得包含 127.0.0.1（防止误指向本地服务）；适配器每次改动经你人工看 diff 后才上线。静态扫描只防「代码里写了不该写的」，证明不了运行时请求与重定向安全——动态一层靠运行时 origin/路径/方法授权（见上一条）。agently-cli 是确定性邮件 CLI（非 LLM Agent 会话），列入 check_redline 的显式例外白名单，不算违反红线。邮件正文安全单独对待：清洗控制字符 ≠ HTML 转义，标题、机构名、AI 摘要按文本节点转义，URL 入 href 前校验 scheme 为 http/https——「投毒夹具 → 适配器 → 邮件正文」的全链路注入测试见 §4.5。

## 2. 阶段总览

| 阶段 | 内容 | 粗估工作量 | 退出标准 |
|---|---|---|---|
| Phase 0 | 修 v1 三个可靠性坑 + 任务计划程序调度 + 预检与运行手册 | 3–4 天 | 故障演练全部通过（含强杀后锁恢复），无人值守连跑 3 天 |
| Phase 1 | 适配器接口、统一 schema、SQLite 重构（仍是原 3 站）+ 真站标定回归 | 8–12 天（含时间窗规则、隔离开关、覆盖缺口记录与补抓；并行观察 3 天另计，不占工作量） | 标定回归与夹具单测全绿，覆盖缺口流程演练通过，新旧并行 3 天（V1 生产/V2 shadow）一致后切换 |
| Phase 2 | 逐站实测公开可见性，按公告量依次接入（每站先标定） | 实测 1 天 + 每站 1.5–2 天 | 每站灰度 ≥3 天（覆盖宽窗轮、夜间空档与故障注入）后正式启用 |
| Phase 3 | 评估必须登录的站点（会话流程用真站验证，不再建登录 mock） | 决策 0.5 天；实施每站 2–4 天 | 通过决策门才实施 |

工作量是单人、熟悉现有代码的粗估，单位为有效工作日。每个阶段结束打 git tag，保留回滚点。

## 3. Phase 0：修 v1 可靠性 + 任务计划调度

0.0 前置：凭据清理。若 README 里的明文账号密码尚未处理：先改密码和证书口令，仓库转私有，再清 git 历史（git filter-repo 或重建仓库）。同时补全 .gitignore：data/、logs/、任何凭据文件。（审阅清单 C1/C2：凭据仍在公开仓库历史中，按已泄露处理，改密码不能等清历史。）本条是施工门禁：改密码与转私有未完成前，不开始 0.1–0.6 的任何代码施工，不与开发并行拖延。

### 0.1 修「邮件先落库」

- 现状：run_check.py 先把新公告写入 seen.json，再发邮件；邮件失败时这些公告永远不会再通知。
- 改法：只有发送成功才落库。

```python
fresh_new, stale_new = split(new_items) # stale = 超过 FRESH_DAYS, 本来就不通知
mark_seen(stale_new) # 不通知的老公告直接标记
if baseline: mark_seen(fresh_new); return # baseline 仅限灰度/shadow 转正式的显式标记(§5.2), 迁移场景禁用(§4.4)
if no_email: return # 演练模式不写库, 避免吞掉公告
ok = send_with_retry(fresh_new) # 立即 / 30 秒 / 2 分钟, 各 1 次
if not ok: ok = send_via_smtp(fresh_new) # agently 失败再走 SMTP 备用
if ok: mark_seen(fresh_new) # 只有发送成功才落库
else: write_local_alert(); sys.exit(3) # 邮件双失败专用退出码, 保持未通知, 下一轮自动重试
```

- agently 两段式调用（v1 实现见 old/run_check.py:129–142，两段都未检查 returncode、第二段靠子串匹配）成功谓词唯一定义：第一段 returncode==0 且输出含合法 ctk_ 确认令牌；第二段 returncode==0 且 JSON 结构化解析得 ok===true（非子串匹配）。任一不满足——非零退出、超时、无令牌、解析失败、ok≠true——一律「未确认」，不得标记已通知；「实际已发出但第二段超时」会重发一次，宁重勿漏。单测必须覆盖组合矩阵：返回码非零但输出含 ok / 返回码为零但无 ok / 有令牌但第二段失败。
- 「成功才确认」的门控覆盖**所有**邮件类型，不只新公告——站点失败告警、恢复通知、日报、watchdog 告警同受约束。Phase 1 起落点为统一 outbox 表（§4.3）：每封邮件一行（message_type/subject/body/recipient/created_at/status/attempts/sent_at/error——行即完整发送快照，重试原样重发不重拼），只有该行确认 sent 才允许更新对应状态（notices.notified_at、site_state.last_alert_at、日报已发标记）。本条要堵的洞：告警实际没发出，但 last_alert_at 已前移，随后被 24 小时节流吞掉，故障从此无人知晓。Phase 0 无库，告警类在 state.json 执行同等规则（发送失败不记 last_alert_at，下一轮照常重试）。
- 取舍：若邮件实际已发出但响应解析失败，下一轮可能重复通知一次——宁重勿漏。
- write_local_alert()：双通道都失败时，把待发公告与告警写入 data/alerts/pending.json（落盘是邮件链路全坏时的最后底牌），同时发一条 Windows 桌面通知（本机可见告警，人在电脑前时立刻知道）；下一轮启动时优先补发，未决告警同时夹带进日报。补发合并：pending.json 与「未落库公告下一轮重新判为新」两条路径会相遇，合并时按 dedupe_key 去重，每键只发一封，成功后才落库。
- SMTP 授权码（备用通道凭据）Phase 0 即用 Windows DPAPI 加密存 data/secrets.dpapi（约十行代码，不必等 Phase 3），不进 git。
- V1 发送证据：Phase 0 起给 V1 增加约三行代码——每次确认发送成功后追加写 data/v1_sent.jsonl（URL、native_id（可得时）、标题、时间）。用途：Phase 1 shadow 切换的 baseline 只认这份清单（§4.4）——v1 的 seen.json 是「先落库后发信」，含从未发出的键，不能当发送证据。

### 0.2 修「静默失败」

- 现状：站点抓取出错只会在「恰好有新公告」时才随邮件带出，其余时候无人知晓。
- 每站每轮记录结果：成功与否、列表总条数 raw_count（关键词过滤之前）、命中条数、错误信息。适配器需要把 raw_count 返回出来。
- 告警规则：
- 单站连续失败 ≥ 2 轮 → 发独立告警邮件，主题固定为「【告警】<站点> 连续失败 N 轮」；同一站点 24 小时内最多 1 封。
- 改版判据分站：列表页站点（国能、华电）此前稳定有数据而本轮 raw_count 为 0 → 疑似改版告警。时间窗站点的 raw_count 是窗内条数，安静日（周末、节假日）本来就可能是 0，不能用同一判据——时间窗站点改版判据改为「每日 7 天宽窗的 raw_count 也为 0」加上响应结构校验失败（返回空但结构正确 = 安静日；结构都不对 = 疑似改版告警）。
- ego 整体无产出（浏览器站全挂）→ 告警。
- 站点恢复 → 发一封恢复通知。
- 退出码：CLEAN / FOUND 为 0；WARN（站点连续失败等告警类）为 2；邮件双失败为 3；主轮等锁超时顺延为 4（deferred，见 §0.6）——分码让任务计划日志能区分「站点问题」「通知链路问题」「本轮没跑成」。一轮里多种并存时取最大优先级：3 > 4 > 2（3 决定是否人工介入）。
- 每轮结果追加写 data/runs.jsonl（时间、退出码、trigger/run_mode、各站 ok/raw_count/命中数/新增数、ego_version、code_version、config_hash——版本字段 Phase 0 就带，Phase 1 直接入 runs 表无需补采）——日报要的「计划/实际轮次、各站成功次数、抓取总数」从这里取。状态存 data/state.json（站点连续失败数、上次告警时间、全局 last_success_at 及其轮次类型——watchdog 用）。原子写规则适用于**一切整体重写的运行时 JSON**（state.json、seen.json、pending.json）：一律「临时文件 + os.replace」，避免崩溃留下半截文件（runs.jsonl 为追加写，不在此列，但读取要容忍末尾半行——崩溃截断的残行跳过不报错；os.replace 偶发被杀毒/索引占用时短暂重试（3×1 秒）后再报错）。Phase 1 两者并入 SQLite。

### 0.3 补「心跳」

- 每日固定一封日报（建议 08:30 那一轮结束后发），主题固定，无新公告也发。内容：各站 24 小时内成功次数、抓取总条数、新增数、最近一条相关公告的日期、计划轮次/实际成功轮次（漏跑可见；deferred 轮计入未成功并列出）。「实际成功轮次」与 watchdog 同口径（见下条）。
- 独立 watchdog：再建一个不依赖 ego 的任务计划（每小时跑一次），仅检查「上一个应触发时刻过后 3 小时仍无成功运行」即发告警（同一告警 24 小时内不重复发；不用固定 20 小时阈值——18h 正常空档加晚登录一小时就误报）。watchdog **不独立发信、不直接写库**——发送与写库收敛到唯一组件：watchdog 任务调 run_check.py --watchdog，判定本身只读状态，告警经同一 outbox 路径发出；与主轮共用同一字节锁，抢锁失败=有轮次正在执行（主链路活着），本轮顺延下小时。**「成功」口径严格限定**：只有 trigger=main、run_mode=prod、未带 --site/--kw、全部启用站点跑完且退出码 0 或 2 的轮次才推进 last_success_at——手动单站、--notify、replay、09:40 宽轮退出 0 都不算（它们活着不代表主链路活着，混入会掩盖主链路死亡）。Phase 0 由 runner 按此口径写 state.json 的 last_success_at（连同轮次类型一起记），Phase 1 起由 runs 表按同口径推导；口径本身有单测。应触发时刻从 config/schedule.json 读（与任务计划触发器同一处定义），不硬编码在脚本里。机器整体不可用时 watchdog 同样失效，最终兜底是「日报没到即人工介入」。外部 dead-man's switch 类服务与不上云约束冲突，不引入。
- 「没收到日报」本身就是系统异常的信号（任务计划挂了、电脑关机、邮件通道坏了）。不依赖云端 ping，符合「不上云」约束。

### 0.4 迁移到任务计划程序

- 触发器：08:30 与 14:30 两个。
- 调度配置同步：schedule.json 是触发时点的唯一事实来源，**覆盖 main（08:30/14:30）、wide（09:40）、watchdog（每小时）三类任务**；tools/sync_schedule.py 依据它创建/更新全部三类任务的触发器并回读校验一致（doctor 同样校验三类）。任务计划触发器不手工直接改——Windows 任务计划不会自动读项目配置，没有此工具配置与实际调度必然漂移；watchdog 每轮顺带校验「任务计划实际触发器 == schedule.json」，漂移（手工改动或配置不同步）在 24h 内以告警暴露。改时点的唯一入口 = 改 schedule.json 后跑一次 sync。
- 运行条件：仅当用户登录时运行（ego 是桌面应用，注销后无法运行，锁屏没问题）；允许唤醒计算机；错过后尽快运行；不并行启动新实例。
- 上线前验证 ego 是否必须在登录会话中运行（决定「无论用户是否登录都运行」是否可用）；漏跑可见性靠日报的计划/实际轮次对比。
- 失败处理：不设任务计划层自动重试——重试语义在 runner 内部（邮件三连试 + 下一轮补发），任务计划层重试会整轮重跑、对反爬站点是成倍的额外访问；站点长期宕机由连续失败告警暴露。任务时间上限 45 分钟；预算不是「9 站 × 4 分钟」单因子，端到端最坏路径拆分与宽窗/备份独立任务见 §0.5。
- 操作：程序填 conda 环境里 python 的绝对路径，参数 run_check.py，起始于 C:/work/ebid-prod（**生产 worktree**，不是开发树 C:/work/ebid）。sync_schedule.py 把任务计划的「起始于」写为该路径；发布 = 在 ebid-prod 切阶段 tag + 跑 doctor。runner 启动时校验：worktree 不干净（有未提交修改）或 code_version 与检出的 tag 不符即拒绝运行并告警——防止定时任务执行到开发中的半成品（Phase 0 生产入口即 V1 改造版，Phase 1 起同一 worktree 跑 V2 薄入口，开发树里的 run_check.py 永远不进任务计划；shadow 期 V2 从开发树以独立入口、独立 data 目录运行，只与生产共用同一绝对路径的 run.lock）。任务计划直接运行 python、不经 shell，**不会自动做 stdout 重定向**——日志由 runner 自建：启动即配 UTF-8 文件日志写 data/logs/run_日期_时间.log（汇总轮内各子进程输出），每次启动顺带清理 30 天前旧日志；stdout/stderr 仍交给任务计划作排错辅路，不作日志依赖。
- 切换顺序：先暂停 Claude 应用里的 avc-agc-bid-watch，再启用新任务，避免双发和并发写 seen.json。

### 0.5 进程超时

subprocess.run(timeout) 只杀直接子进程。改为 Popen，超时后 taskkill /PID <pid> /T /F 清理整个进程树。超时预算按**端到端最坏路径**拆分——采集、加深翻页、正文抓取、邮件三连试、SMTP 备用占同一轮时间（宽窗与备份已拆至 09:40 独立任务，见下条）：

- 主轮（08:30/14:30）总超时 40 分钟（任务上限 45）＝采集 ≤28 分钟（分站 4 分钟，含加深翻页与正文抓取；超时跳过剩余站点并告警）＋通知尾部 ≥12 分钟（三连试固定等待约 3 分钟 + SMTP 备用 + 日报）。备份已拆至 09:40 任务（见下条），不再占主轮预算。采集与通知抢时间时**通知优先**——采集全成功却在发信前被总超时杀掉，等于漏报一整轮。
- 每日 7 天宽窗与 SQLite 备份（Phase 1 起）拆出主轮：09:40 独立任务（**上限 80 分钟：等锁最多 30 分钟不计入执行预算**——45 分钟上限会在等锁后把宽窗截断）跑宽窗 + VACUUM INTO + integrity_check，与主轮共用同一字节锁（§0.6），错峰 70 分钟正常不相遇；相遇时（主轮补跑、人工任务或手动轮超时）按锁规则处理：抢锁失败→每 5 分钟重试、累计等待 30 分钟；仍失败→本次顺延（写 runs，result=deferred），由下一轮读 deferred 标记补做（§0.6，任务计划「错过后尽快运行」只补从未启动的任务、救不了已启动又退出的）；当日始终未跑成→次日日报列为未决异常。幂等：宽窗重复命中由 dedupe_key 吸收、VACUUM INTO 目标带时间戳（文件已存在即换新时间戳重试），多次补跑不产生重复通知或重复备份。宽窗失败走常规站点失败告警，不改变主轮退出码语义。

### 0.6 手动监控（人工随时触发）

- run_check.py 支持手动运行：默认跑完整一轮；`--site <站点>` 只查单站（Phase 1 适配器接口下天然支持），`--kw <关键词>` 追加临时关键词。结果打印到控制台。
- 手动轮默认**不发邮件**：发现的新公告保持「待通知」，由下一轮定时任务正常送出（要立即送加 `--notify`）——同一套去重与落库，不会双发、不会吞公告。手动轮同样写 runs 记录，日报的「实际轮次」里标记 manual。
- 互斥：主轮、09:40 任务、手动运行、watchdog 入口（§0.3）共用同一绝对路径的 data/run.lock，锁语义用 OS 自动释放的字节锁，而非「启动创建/正常退出删除」——文件残留式锁在强杀、崩溃、断电后永久阻断。实现：run.lock 常驻，启动时 msvcrt.locking(fd, LK_NBLCK) 锁首字节；锁文件内容记 pid、开始时间、trigger（持锁超过该类任务上限即告警——字节锁在进程死后自动释放，但进程活着挂死不会，锁元数据让它可见）。**抢锁策略按触发类型区分**（旧「抢不到即退出」对主轮不成立：晚登录时任务计划同时补起 08:30 主轮与 09:40 任务，主轮输锁退出就丢整轮，最长 18h，且「错过后尽快运行」只补跑从未启动的任务、不补跑已启动又退出的）：main 最多忙等 20 分钟（计入 40 分钟总预算），仍失败记 result=deferred、退出码 4，日报与 watchdog 可见，下一轮启动读 runs 的 deferred 标记后由时间窗机制自动补做（§4.5）；manual 立即失败并提示；wide 按 §0.5 等 30 分钟后顺延；watchdog 抢锁失败=主链路活着，顺延下小时（§0.3）。任务计划的「不并行启动新实例」只管它自己，管不住手动跑；不防并发就会双发并抢写状态文件。
- 用途：临近截标人工加查（与 §5.4 的配置调频互补，临时加查不必改配置）、改完适配器的即时验证、怀疑漏公告时的补查。Phase 1 起另有 --backfill --site <站点> --from <起> --to <止>：时间窗站按发布时间范围补抓（消除 §4.5 coverage_gaps 缺口的主要手段），结果走同一套去重与通知；列表站无时间参数，不支持 --backfill，只能人工站内补查。

涉及文件：run_check.py（改）、data/state.json（新）、config/schedule.json（新）、tools/sync_schedule.py（新）、tools/doctor.py（新）、docs/runbook.md（新）、.gitignore（改）。

退出标准（故障演练）：
1. 故意让 agently 和 SMTP 都失败：新公告不丢，恢复后下一轮补发。
2. 把某站 URL 改错：2 轮后收到告警，改回后收到恢复通知。
3. 日报每天按时到达。
4. 任务计划无人干预连续运行 3 天。
5. 任务管理器强杀进行中的一轮后立即重跑：能正常获得锁、无残留阻断（验证字节锁随进程释放）。
6. 施工产物核对：config/schedule.json、tools/sync_schedule.py（回读校验一致，覆盖 main/wide/watchdog 三类）、tools/doctor.py 全绿、docs/runbook.md、runner 自建文件日志与 30 天清理均已交付。
7. 无 Docker 自动化单测全绿：假发送器门控（发送失败不落库）、pending 合并去重、原子写故障注入、watchdog 成功口径判定（§0.3）。

说明：Phase 0 不依赖任何测试设施，演练 2 先用改错 URL 手工完成；这四项演练在 Phase 1 由 run_check.py --replay（读 data/out 夹具 + 假发送器，§4.4）改写为可重复的自动化用例。但不等 Phase 1：无 Docker 的 pytest 单测在 Phase 0 即落地——假发送器门控（发送失败不落库）、pending 合并去重、原子写故障注入（预置半截 JSON，断言下次启动正常恢复），纯 Python 零服务依赖。

### 0.7 预检与运行手册

- tools/doctor.py（一条命令预检，任一项失败即非零退出）：python 与依赖可用、ego 就绪（--version 探测）、任务计划触发器 == schedule.json（复用 sync_schedule 的回读校验）、DPAPI 凭据可解密、data/ 所在盘余量、系统时区与时钟。启用任务、改配置、怀疑异常时先跑它。
- docs/runbook.md（一页）：安装（conda 环境与依赖）、启用/暂停/改触发时点（改 schedule.json → sync → doctor）、手动跑一轮（§0.6）、日志位置与看法、备份恢复（Phase 1 起：停任务 → 用最近 VACUUM INTO 副本替换 → integrity_check → 重启）、常见故障对照（抢锁提示「上一轮还在进行」、邮件双失败、日报没来分别意味着什么——先跑 doctor）。

## 4. Phase 1：适配器接口、统一 schema、SQLite

### 4.1 目录结构

```
ebid/ # 开发树 C:/work/ebid；生产另用独立 worktree C:/work/ebid-prod（只检出阶段 tag，§0.4）
run_check.py # 薄入口: 主轮/手动/09:40 宽窗/watchdog 统一经此进锁
core/ # Python: config, db, dedupe, runner, notify, report, keywords
core/adapters.schema.json # 适配器输出 JSON Schema 契约 (§4.2)
adapters/ # 每站一个适配器 (.mjs 浏览器站 /.py 静态站)
_lib/common.mjs # 公共库: 导航白名单、等待、清洗、输出
config/sites.json # 站点开关, space 名, 是否通知, 检查频率, 实测容量与页数定标
config/schedule.json # 触发时点唯一事实来源: main/wide/watchdog 三类 (§0.4, Phase 0)
docs/site_matrix.md # 站点实测矩阵 + 未覆盖清单 (§5.1/§5.2, Phase 2 填充, Phase 1 建骨架)
docs/runbook.md # 运行手册 (§0.7, Phase 0)
tools/sync_schedule.py # schedule.json → 任务计划触发器同步 (Phase 0)
tools/check_redline.py
tools/doctor.py # 上线/排障预检 (§0.7, Phase 0)
tools/import_seen.py # v1 seen 迁移导入, 含 legacy_seen_map 生成 (Phase 1)
tools/export_seen.py # v2→v1 回退导出 (Phase 1)
scripts/relogin.mjs # Phase 3 人工重登
data/ # 运行时: bid.db、state.json、runs.jsonl、run.lock、alerts/、backup/、secrets.dpapi、logs/、out/<run_id>/
tests/
  unit/ # 夹具单测: 解析/清洗/去重/门控 (不访问网络)
  e2e/ # 真站标定回归 (pytest -m e2e, 访问真站, 见 4.5)
  fixtures/ # 真站页面/接口快照 (录制一次) + replay/ (适配器输出夹具, §4.4)
  calibration/ # 每站标定定义: 查询参数 + 期望答案 (JSON)
ebid-v2-mockweb/ # [封存] 原 mockweb 实现与文档, 不再使用不删除
```

- 国能E招这类静态站保留 Python 适配器，与浏览器适配器输出同一种 JSON，不为统一而重写。
- 先做 1 小时 spike：验证 ego-browser nodejs < 脚本 这种 stdin 方式下，相对路径 import 是否可用。不可用就改用绝对 file URL 动态 import()，或由 Python 把 _lib/common.mjs 与适配器拼接后再喂给 ego。**再加半天容量测量**：各站日公告量、每页条数、能否服务端按关键词收窄——§4.5 的页数上限（每 24h 约 5 页、绝对 30 页、列表站 3→10 页）目前全是拍的，犀维聚合多集团、日量可能超 5 页，不实测就是每轮触顶。据此把各站实测容量写入 sites.json，页数参数以数据定标。

### 4.2 适配器输出约定（每站一个文件，故障互相隔离）

```json
{ "site": "华电", "schema_version": 1, "run_id": "r20261026-0830-x7k2", "ok": true, "error": null, "session_state": "public",
"raw_count": 20, "rejected": [], "exhausted": true, "page_limit_hit": false, "stop_reason": "short_page", "pages_fetched": 2,
"items": [ { "title": "…", "notice_type": "招标公告", "status": "active",
"published_date": "2026-10-20", "url": "…", "native_id": "…",
"deadline_raw": "投标截止时间：2026-11-05 17:00", "deadline": "2026-11-05T17:00:00+08:00",
"org": "", "project_no": "", "channel": "dom"} ]}
```

**严格契约（不再只是示例）**：core/ 持有 adapters.schema.json（JSON Schema），runner 入口对适配器输出先校验后入库。顶层必填 schema_version（不识别即整站失败，防格式静默漂移）；item 必填 title、published_date、url 及 native_id（或可哈希替代）；notice_type、status、session_state 为枚举；时间字段存三元组「原始文本（*_raw）＋规范化值（ISO 8601）＋来源时区」，published_date/deadline 同规则，规范化失败的置空并计入 rejected 原因。单条 item 校验失败进 rejected[]（带原因）——不静默填默认值、不整站失败；JSON 解析不出或顶层结构缺失才算整站失败。任一校验异常的轮次**不推进覆盖水位**（coverage_from/to 与 last_ok_at 维持原值，§4.5）：坏数据上算不出可信窗口，fresh 判断与时间窗推进都以校验通过为前提。

**输出传递与陈旧读防护**：适配器不写固定路径 data/out/<站点>.json——上一轮残留文件会被误当本轮结果。输出写 data/out/<run_id>/<站点>.json（run_id 由 runner 每轮生成并注入）或直接经 stdout 返回；runner 校验文件属于本轮 run_id，缺失、run_id 不匹配、修改时间早于本轮启动，一律按该站本轮失败处理，绝不消费陈旧输出。顶层另增必填翻页元数据：`exhausted`（是否翻页穷尽）、`page_limit_hit`、`stop_reason`、`pages_fetched`——§4.5 的 last_ok_at 前移与触顶判定依据这些显式字段，runner 不靠推测；一并纳入 adapters.schema.json 必填。

### 4.3 SQLite 表

| 表 | 关键字段 |
|---|---|
| notices | id、publisher、source_site、native_id、native_id_namespace（默认=source_site）、title、title_norm、notice_type、published_date、url、sources（同公告多渠道链接）、deadline、org、project_no、status、first_seen、matched_keywords、dedupe_key（唯一索引）、notified_at、revision_hash、last_notified_revision |
| runs | id、started_at、finished_at、result（clean/warn/mail_fail/deferred 等）、run_mode（prod/replay/test）、trigger（main/manual/wide/watchdog）、mail_status、ego_version、code_version（git describe）、config_hash（生效配置摘要）、effective_options（本轮实际生效参数） |
| site_runs | run_id、site、ok、error、raw_count、matched_count、new_count、session_state、duration_s、coverage_from、coverage_to |
| site_state | site、consecutive_failures、last_ok_at、last_alert_at、last_nonzero_raw_at |
| coverage_gaps | site、gap_from、gap_to、reason（漏跑/触顶/超 7 天截断）、detail、created_at、resolved_at（空=未决，日报持续列出直到补抓或人工标注解决） |
| outbox | id、message_type（notice/alert/recovery/digest/watchdog）、subject、body（渲染完成的正文快照）、recipient、created_at、status（pending/sent/failed）、attempts、sent_at、error——所有邮件的唯一发送队列，「成功才确认」的落点。**行即快照**：创建时固化主题、正文、收件人（含本封覆盖哪些公告、依据哪个 revision_hash、日报覆盖哪个统计窗口），重试原样重发该快照，绝不按当前库状态重新拼装——重拼会把「当时该发的」换成「现在看着像该发的」 |
| outbox_items | outbox_id、dedupe_key、revision_hash——一封公告邮件内含的公告与所依据版本；行确认 sent 后据此回写 notified_at 与 last_notified_revision |

- dedupe_key = **publisher（公告主体）** + 类型 + (带命名空间的 native_id 或 sha1(title_norm + 日期))——不再含采集渠道：同一公告多渠道出现时是一个键、只通知一次，后到的来源链接并入 sources；采集渠道视角由 source_site 与 site_runs 保留。**native_id 必须带命名空间**（native_id_namespace，默认=source_site）：publisher 相同不证明各渠道 id 规则相同——同一公告跨源可能 id 不同（照旧重复通知），不同公告数字 id 撞车会被错误合并。跨源按裸 id 直接合并仅限**实测证明同 id 空间**的渠道对：接入同 publisher 的第二个渠道时，用一组已知公告对实测两侧 id 是否一致，结论记入 sites.json（same_id_space）；证明成立后两源的 native_id_namespace 显式设为同一个值（默认=source_site 会让两源命名空间不同，需覆盖）；未证明的渠道对用显式 ID 映射表或退回 title_norm+日期哈希合并。publisher 由 sites.json 为每个采集站点映射（一个 publisher 可对应多个 source_site，大唐=官网+犀维即一例；国能各平台是否同主体同 id 在接入时实测确认，是则同规则合并，否则按平台拆 publisher）。native_id 优先（从 URL/接口提取，如犀维 gg_id、华电 onclick id，天然免疫标题截断），sha1 仅用于确无 id 的站点——截断标题去掉省略号后仍只是完整标题的前缀，两者哈希并不相等，不能当第一选择。dedupe_key 建唯一索引：撞键走更新路径（含通知状态机判断），不产生重复行。
- title_norm：去掉省略号和空白、统一全半角，解决 v1 浏览器站标题被截断导致同条公告键不稳定的问题。
- 变更公告的类型进入键，作为新事件通知（截止时间变更对投标很关键）。
- notified_at 为空即待通知——这是 Phase 0.1 修复在数据层的通用化；用 sqlite3 标准库，写入走事务，避免 seen.json 的非原子写入问题。
- 同键内容变化：dedupe 命中后比较 revision_hash（见通知状态机；含 deadline、status、org、project_no）——标题不参与（同一 native_id 在 dom 通道可能被截断、在 api 通道完整，标题哈希一变就误判「公告变更」，每日 7 天宽窗重读还会放大误重发）；标题层面的实质变化由「变更公告类型进入 dedupe_key」兜底。确需比对标题时只用规范化前缀比较、且限同一通道内。
- 入库前字段级合并：同键数据（多通道、多轮）先合并再比较——空值不覆盖已有值（dom 回退通道常缺 deadline/org/project_no，api 通道才有值，直接哈希会随当轮通道抖动、反复误触发「信息变更」，每日 7 天宽窗还会放大）。revision_hash 基于**合并后**的规范化记录计算（时区、空白、全半角先统一）。空 → 有值算「首次补全」，不触发变更通知（只是补信息，不是公告变了）；有值 → 不同值才算变更。通道交替场景（同键 dom/api 轮流取数）有夹具单测。
- 通知状态机：notified_at 为空=待通知，outbox 行确认 sent 后置时。变更检测不再只比 deadline：revision_hash = sha1(status + deadline + org + project_no)——native_id 与 notice_type 已在 dedupe_key 内，进哈希无意义，去掉；覆盖且仅覆盖这些结构化字段：截止变更、终止/撤回/暂停（status 变化）、项目编号与采购单位变化——正文与附件未入库，**招标范围类修改本阶段检测不到**，该能力属 Phase 2 正文/附件版本哈希（§4.3 扩展位 content_hash、§5.3），不在 Phase 1 宣称范围；标题不参与哈希（截断差异防误判，见上条）。dedupe 命中且当前 revision_hash ≠ last_notified_revision 即信息变更——清空 notified_at 待重发（邮件主题标注「信息变更」），发送成功后更新 last_notified_revision；last_notified_deadline 字段被取代（deadline 已含在哈希内）。变更轨迹由 last_notified_revision + outbox + runs 可追溯。上一轮「outbox 表不预设」的决定按本轮评审撤销：outbox 为定案，它是所有邮件类型共用「成功才确认」的载体（§0.1）。
- outbox 建行与重试规则：outbox_items 建 (dedupe_key, revision_hash) 唯一约束（排除已取消行）——邮件通道持续故障期间同一公告同一版本只有一行，恢复后不会一口气发出 N 封重复邮件。每轮先原样重试旧的 pending/failed 行，再只为「没有任何行覆盖」的待通知项建新行；failed 重试有上限（如 20 次），超限标 failed-terminal 进日报异常。非公告类快照（告警/恢复/日报）加 expires_at，过期标 expired 不再补发——陈旧告警补发只会制造混乱；恢复通知补发前先确认对应告警行已 sent（防「恢复」先于「告警」到达）。提供经同一字节锁的 --outbox-cancel / --outbox-requeue 工具（改收件人后旧快照仍发旧地址是快照语义的代价，用 cancel+requeue 显式处理）。
- 库备份：不直接拷文件（WAL 未 checkpoint 时拷 .db 会丢最近写入，写入期间拷贝也可能得到损坏副本），只走 SQLite 自身机制——VACUUM INTO 'data/backup/bid_日期时间.db'（目标文件须不存在，得到压缩后的一致快照）或 sqlite3.Connection.backup()。每日 09:40 任务执行，**备份独立于宽窗成败**（宽窗失败不阻断备份，备份失败不影响宽窗结果记录）；滚动保留 14 份；备份后对副本跑 PRAGMA integrity_check；Phase 1 验收前做一次「从备份恢复」演练。WAL 非必需（单用户；「单写入进程」由设计保证：主轮、09:40、手动、watchdog 全部经 run_check.py 同一入口、抢同一把字节锁，不存在并发写库的第二进程），不开。
- Schema 版本与迁移：PRAGMA user_version 标记库结构版本；迁移在单事务内执行（失败整体回滚），执行前自动做一次 VACUUM INTO 迁移前备份；代码遇到高于自身已知版本的库拒绝启动（防旧代码写坏新库）。
- 各表保留策略：runs/site_runs 保留 400 天（跨年对比与审计），outbox 已发送行保留 90 天（更早轨迹由每日备份与 notices.last_notified_revision 兜底），data/alerts 落盘文件 30 天；清理随 09:40 备份成功后顺带执行，误删可从备份恢复。bid.db 是「已通知」状态的唯一事实来源，损坏等于全量重发或历史丢失。
- 详情快照与全文检索 Phase 1 不做（§5.3 只匹配不入库），notices 表留扩展位（content_hash / body_path 列）——Phase 2 用它做正文/附件版本哈希，检测招标范围类修改（Phase 1 的 revision_hash 不覆盖，见通知状态机）；需求 Q10 顺延。

### 4.4 迁移与测试

- tools/import_seen.py：一次性导入 old/data/seen.json（v1 归档时已移入 old/，标为 legacy 已通知），负责键格式转换（v1 键 → v2 dedupe_key）。转换不靠猜测——v1 seen 无 native_id、标题可能已截断，「v1 键 → v2 native_id 键」与「v2 当前标题 → 原始 v1 标题哈希」都无法普遍成立。导入时逐条写 **legacy_seen_map 表（legacy_key ↔ notice_id/dedupe_key、match_status）**：能对上的记映射，对不上的记 unmatched；unmatched 键进异常清单人工处理，**不静默丢弃，也不静默生成一个看似合法的新键**。异常清单只列 FRESH_DAYS 内的键，更老的自动标 expired——全量清单大到无人处理等于变相静默丢弃；导入前先用 v1 seen 与 V2 首轮抓取试算一次匹配率（华电标题截断，命中率可能偏低，据此设定人工复核的工作量预期）。该映射表同时是回滚导出（§7）的依据。**执行时机：shadow 开始时，不是切换日**——shadow 期 V2 库就已含 legacy 标记并正常去重，切换日不再有导入动作（时序见 §4.4 并行段）。**迁移后禁止跑笼统 --baseline**——那会把切换窗口内新出现、本该通知的公告一并标为已处理。正确路径：导入后首轮差集（不在 seen.json 的新公告）按正常流程送出；个别确已人工处理过的用 --mark-notified <键> 显式标记。已知限制：v1 是「先落库后发信」，seen.json 里含邮件失败从未发出的键，从 v1 数据无法识别，记为 v1 既有损失。import_seen/export_seen 等一切写库工具同样先取 run.lock（并设 busy_timeout）——否则 §4.3「不存在并发写库的第二进程」不成立。
- pytest 单测覆盖（不访问网络）：title_norm、dedupe_key、关键词正则、邮件落库门控（用假发送器）、各站夹具解析（tests/fixtures/<站点>/ 下录制的 HTML/JSON）。
- runner 重放与故障注入：run_check.py --replay 读 **tests/fixtures/replay/** 下录制的适配器输出夹具（data/out/ 在 .gitignore 里且会被清理，不是夹具位置；tests/fixtures/<站点>/ 存的是原始页面、不是适配器输出，两者分工不同）+ 假发送器，把 Phase 0 的演练 1/2（邮件双失败不丢公告、连续失败触发告警）变成自动化用例——只测编排逻辑，不访问网络、不依赖任何服务。replay 模式注入固定 run_id 并跳过修改时间校验（§4.2 的陈旧读防护在重放下无意义，注入使其自洽）。
- 关键词集中在 core/keywords.py：包含词、排除词；ASCII 词加边界，如 (?<![A-Za-z])AVC(?![A-Za-z])。关键词做成配置表：覆盖全称/简称（自动电压控制/自动发电控制）、全半角与大小写、业务关联叫法（调频、涉网等，按行业习惯补全）；Phase 1 只匹配标题（此阶段无正文抓取）；正文匹配与 match_source=body 属 Phase 2 §5.3 试点，届时再启用，相关测试一并随 Phase 2 落地；notices 表记录命中词便于复盘；宁可误报不漏报；每月人工抽检一次——在各站内手工检索关键词，与监控命中结果比对，评估召回。
- 新旧并行 3 天：**V1 是生产通知方、V2 是 shadow**——V1 任务照常发信不变，V2 以 notify: false 运行（只抓取入库，「将通知清单」写入日报），比对两侧条目集合，差异可解释后切换。旧表述「V1 只演练不发信」废弃：那等于让未验收的 V2 提前承担生产通知，是灰度上线不是并行验证。**shadow 双跑错峰**：schedule.json 里 V2 shadow 轮用 08:50/14:50（与 V1 的 08:30/14:30 错开 20 分钟，避免同时抢 ego 与同站访问），V2 shadow 日报主题加 [shadow] 前缀。**shadow 开始时先跑 import_seen（§4.4 导入段）**——旧键标 legacy-notified，V2 库在并行期即正常去重；若拖到切换日才导入，shadow 期 V2 库是空的，FRESH_DAYS 内所有已被 V1 发过的公告都进「将通知清单」，复核量直接爆炸。切换顺序（既不吞件也不引发重发风暴）：**baseline 只对「有 V1 已发送证据的交集键」执行**——证据 = data/v1_sent.jsonl（§0.1，Phase 0 起 V1 逐封追加；不能用 V1 seen.json——v1 先落库后发信，seen 含从未发出的键）；交集按 URL 或 native_id 匹配，不按标题（华电标题截断）。**V2-only 条目（V1 漏掉、只有 V2 发现的）禁止随 baseline 封存**：逐一人工复核，有效公告保持待通知、切换后照常送出（补发），无效或误报显式标注原因。存在未解释差异不得通过切换验收（§4.6）。切换日动作只有三步：交集键 baseline → 暂停 V1 任务 → V2 置 notify: true 成生产方，前两轮逐封核对；切换前检查 data/alerts/pending.json——为空才切，非空则逐条处置（补发或转入 outbox）后再切，不带未决告警换系统。baseline 与 V1 停止之间由 V1 送出的少量公告 V2 可能重发一次——宁重勿漏，已接受。

### 4.5 真站标定回归（本版核心，取代自建测试 WEB）

**原理**：真站历史公告不改写。选定一个历史时间窗（或关键词/类型组合），窗内公告集合固定；一次性人工核对窗内 AVC/AGC 公告，录制成「期望答案」；此后回归时适配器带同一组查询参数请求真站，断言抽取结果与期望一致。改版、字段映射回归、翻页、去重都能用同一套数据验证——而且验证的是真站本身，不存在「mock 与真站不一致」问题。

**时间窗是统一参数（生产 24h / 测试 N×24h）**：凡站点自带发布时间查询（大唐 cdt-ec、犀维 cweme，及 Phase 2 多数平台），适配器生产运行一律按「发布时间 ∈ [start, now]」查询取数，不抓默认列表页。完整规则：

- **窗口起点**：start = max(now − 7d 回看上限, min(now−24h, last_ok_at − 1h 重叠))——漏跑多轮自动补齐，但回看不无限拉长（超过 7 天的缺口不再自动追赶：写入 coverage_gaps、在日报「未决缺口」持续列出，直到人工 --backfill 补抓或标注解决——缺口未消每天都要报，不许只在日志里出现一次；同时防站点长期失败后窗口越滚越大）。
- **last_ok_at 前移条件**：仅当本轮「翻页穷尽且未撞页数上限」时才前移到本轮窗口终点；触顶或翻页被截断则保持不动，下一轮从原位置重试。穷尽与触顶由适配器显式元数据判定（exhausted / page_limit_hit / stop_reason / pages_fetched，§4.2），runner 不靠推测。
- **翻页与页数上限**：翻到穷尽（下一页为空或短页即停）；页数上限按窗长折算（基线每 24h 约 5 页，宽窗按比例放大），另设绝对上限 30 页——撞任一上限即停、记「触顶」告警、不前移 last_ok_at（补跑和 7 天宽窗最容易超页，必须有上限而不是无限翻）。**上限数字以 §4.1 容量测量的实测值定标写入 sites.json，此处数值仅为缺省兜底**。列表站的触顶语义另定：常规 K 页属设计覆盖——常规轮翻完 K 页即 exhausted=true、不算触顶；只有漏跑补跑的加深翻页（3→10 页）到加深上限仍未穷尽才算 page_limit_hit 告警并写 coverage_gaps。
- **每日 7 天宽窗兜底**：09:40 独立任务（§0.5 拆分）对时间窗站点加跑一次 7 天宽窗，防窗口逻辑缺陷造成静默漏抓；重复命中由去重键吸收。

标定回归把同一参数拉长为 N×24 小时，圈进已知历史公告——生产与测试走同一条查询路径，只差窗长。**无时间查询的站点（国能、华电）**仍抓默认列表页，公告会在列表页滚走：本轮检测到漏跑（距上次成功超过 24h）时自动加深翻页（如从常规 3 页加深到 10 页），并在日报记录实际翻到的深度；翻到加深上限仍未穷尽（未出现短页）即触顶——持续告警并写入 coverage_gaps（gap_from/to 为空、detail 记实际页深），滚出加深范围的老公告由人工在站内补查（列表站无时间参数，--backfill 帮不上，这是列表站的固有覆盖上限）。

**生产窄窗必须先对已知答案验证**：now 可注入（环境变量 BID_NOW）；标定时除长窗外，另对已知公告发布时刻前后各构造一个终点为 now 的 24h 窗跑一遍并断言命中——验证端点闭合语义（含不含边界）、时区与服务器时钟偏差。

**测试开关与生产隔离**：BID_NOW、agently 禁用开关只在测试模式（--replay / pytest -m e2e）下读取，生产模式读到即报错退出；每次启动在日志里打印生效的 now 与运行模式；check_redline 增查这些开关不出现在生产配置；--replay 强制使用临时 data 目录，与生产路径相同即拒绝启动。

**各站标定手段（按站点自带查询能力选）**：

| 站点 | 控制手段 | 标定示例 |
|---|---|---|
| 大唐 cdt-ec | more.jsp 发布时间起止（精确到秒），另有公告名称/采购单位/招标编号筛选 | 窗 2026-06-01 00:00:00 ~ 2026-06-30 23:59:59，窗内含【山西公司阳城电厂柳家河、照山光伏电站AGC、AVC、PMU升级改造】招标公告（2026-06-25 19:53:34）等已知公告 |
| 犀维 cweme | getList 接口 startDate/endDate + messagetype/message_title（v1 已用） | 同上思路：选窗录制期望集 |
| 华电 chdtp | 无时间参数；用 ggbt 关键词圈定（选一个只命中已知历史公告的词），或退化为结构断言 | 关键词「PMU升级改造」级别的长词，命中集小且稳定 |
| 国能E招 | 静态站无查询：固定 URL 只断言结构与 raw_count>0；解析正确性靠夹具单测 | moreinfo/2/3 页正则抽取的结构断言 |

**标定文件**：tests/calibration/<站点>.json —— 查询参数、期望条目（标题/native_id/日期/类型）、录制日期、期望 raw_count。夹具快照存 tests/fixtures/<站点>/（第一次录制时保存页面/接口原文，供单测离线复现）。

**无法向真站点播的场景全部下沉到夹具单测**：empty / error5xx / timeout / layout_changed（改夹具副本的 DOM）/ truncated_titles / changed_notice / poisoned（投毒标题、非白名单链接）——在本地把夹具改坏来模拟，不依赖任何服务。poisoned 用例是**全链路**的：投毒夹具 → 适配器 → runner schema 校验 → 邮件正文渲染，断言危险内容在每层被拦（清洗、HTML 转义、href scheme 校验）——只测解析层挡不住注入到邮件 HTML 的载荷。

**执行与频率**：pytest -m e2e 驱动；每站每轮 1–2 次请求，只在改适配器后与发布前各跑一次，访问量远低于人工浏览；开发期间用 dev-* 空间。浏览器站 E2E 前先探测 ego 就绪（ego-browser --version），缺则报错不静默跳过。另设金丝雀两层：每周对**全部活跃站**做轻量结构检查（raw_count>0 + 结构断言，1 请求/站——只测 1 站轮换意味着 9 站时同一站 9 周才轮到一次，谈不上早于月度抽检发现）；深度标定按站轮换，**每站间隔不超过 30 天**。pytest -m e2e 与金丝雀一律强制隔离：临时 data 目录（复用 --replay 的强制逻辑）、notify 接假发送器、浏览器只用 dev-* 空间——碰生产库/生产空间/真实通知通道即拒绝启动。

**通知链路测试**（无 Docker）：pytest 进程内起假 SMTP 接收器（aiosmtpd，仅测试依赖）接收并断言邮件内容；agently 通道用环境开关禁用或替换为假 CLI，以演练「agently 与 SMTP 双失败」。

**标定漂移的处理**：站点若改写/删除历史公告导致回归失败，先人工确认是站点行为还是适配器回归——这本身就是有价值的改版信号；确认后重录标定文件并在其中注明重录原因。

**mockweb 处置**：ebid-v2-mockweb/ 目录封存（保留在仓库与 git 历史中，不再维护、不再纳入任何流程）；BID_ENV=mock、config/sites.mock.json、test-* 浏览器空间、compose/mailpit profile 等机制全部取消。

### 4.6 Phase 1 验收

- 全部单测绿；3 站标定回归各跑一次绿。
- 从备份恢复 bid.db 演练一次成功。
- 新旧并行 3 天（V1 生产、V2 shadow）差异**全部可解释**（无未解释差异残留）后按既定顺序切换：交集键 baseline、V2-only 人工复核完毕（§4.4）；旧入口转 run_check_v1.py 归档。
- 覆盖缺口全流程演练一次：人为制造缺口（如临时把窗口起点改晚）→ 日报未决缺口出现 → --backfill 补抓 → 缺口标记解决。
- 切换前用 tools/export_seen.py 生成一次 v2→v1 回退产物并抽查（只验证产出、不执行回退）。
- 目录树（§4.1）所列 Phase 1 产物齐全：adapters.schema.json（含翻页元数据）、tools/import_seen.py（含 legacy_seen_map 生成）、tools/export_seen.py、docs/site_matrix.md 骨架（未覆盖清单 Phase 2 填充）。

## 5. Phase 2：逐站实测与按量接入

### 5.1 先实测，再动手（约 1 天）

用无痕窗口、不登录，逐站填表。实测对象共 9 站 = 8 个已注册平台（以 2026.10.23 凭据台账「黄标」8 行为准，文件在仓库根目录、受 gitignore 保护）+ 国能E招（v1 静态站，无账号）；大唐的公开采集通道为犀维网，与大唐同行评估。实测表同前（略，见 docs/site_matrix.md）。

### 5.2 接入顺序与每站固定流程

按「公开可见 且 相关公告量大」优先，反爬越重越靠后：

1. 在 dev-* 空间探索真站的页面与接口，访问量保持很小。
2. 保存公开页面/接口快照到 tests/fixtures/<站点>/，并按 §4.5 录制标定文件（查询参数 + 期望答案）。
3. 对着夹具单测写适配器（离线），用标定回归验证（在线，1–2 次请求）。
4. 灰度：config/sites.json 中设 notify: false，只入库不发通知，「将通知清单」写入日报。观察不少于 3 天，必须覆盖一次 09:40 宽窗任务、一个夜间空档、一次人工故障注入（改错 URL → 收到告警 → 改回 → 收到恢复通知）——观察 2 轮什么都验不了。
5. 打开通知前跑一次显式 --baseline：灰度期入库公告标记为已处理（灰度=仅观察，不补发历史——补发只会用旧公告轰炸邮箱）；随后置 notify: true 正式启用，前两轮逐封核对发送内容。

范围变更（R1 的「8 平台全接入」改为按公告量实测决定、登录类默认不做）：未接入与暂缓站点维护在 docs/site_matrix.md 的「未覆盖清单」，每月人工巡检一次，让覆盖缺口可见；若 AVC/AGC 公告实测集中在登录类站点，回到 §6 决策门重评。

### 5.3 正文二次匹配（试点 1 站，1–2 天）

只匹配标题会漏掉「AVC 只是大项目一个子项」的公告——但标题预筛本身也有盲区：「设备采购」「物资招标」「框架采购」类标题不含触发词，正文有 AVC 也进不了二次匹配。本节定位是**改善召回**，不宣称消除该类漏报。试点分两步：第一步（标定周）对窗口内**全部**新公告抓正文，用已知答案集实测召回率与请求成本——没有这组数据就无从判断预筛损失多少召回；第二步依据实测决定是否保留标题预筛（若全量成本可接受则直接全量抓正文，预筛取消）。命中记 match_source = body。**正文/附件版本哈希（content_hash）随本节落地**：启用 notices 扩展位，正文抓取时记录哈希，变化即「招标范围变更」通知——Phase 1 的 revision_hash 不覆盖正文（§4.3 通知状态机），该能力在此补上。每轮限量并加 2–5 秒随机间隔，请求量远低于人工浏览。

### 5.4 频率

频率基线（已接受，较需求 R5 的 ≤2h 放松）：每日 2 轮（08:30/14:30），最坏延迟 18h、平均约 7.5h=(6²+18²)/(2×24)。夜间空档是主因：若要压缩，08:30/12:30/16:30 最坏 16h，五点最坏 12h，达到 ≤2h 需每日 ≥12 轮且覆盖夜间——与并发预算、反爬、维护成本权衡后暂不做。临近截标的加查优先用 §0.6 手动监控（不动配置、随时可跑），确有持续需求再把该站频率调高；触发点增减须同步修改任务计划。投标窗口通常是几天到几周，频率翻倍只增加反爬风险和资源占用。

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

### 6.4 会话与登录流程验证（不再建登录 mock）

- sessionAlive 探测、会话失效后降级为公开采集并告警、relogin handOff、重登后自动恢复——全部在选定真站上低频验证（人在场、dev 空间旁路验证会话探测逻辑）；验证脚本复用标定回归的骨架。
- 真站会话寿命按 6.1 第 2 项实测；不模拟假 TTL。

## 7. 风险与回滚

| 风险 | 对策 |
|---|---|
| 站点改版导致适配器失效 | 判据按 §0.2 分站：列表站 raw_count=0，时间窗站 7 天宽窗 raw_count=0 且响应结构校验失败；周金丝雀与标定回归把改版坐实（夹具单测防的是适配器自身回归，检测不了真站改版）；改版只改单个适配器，随后重录夹具与标定 |
| 站点改写/删除历史公告，标定漂移 | 回归失败先人工甄别「站点行为 vs 适配器回归」；确认后重录标定并注明原因（§4.5） |
| 标定回归依赖网络与真站可用性 | 回归只在改适配器后/发布前跑，跑不了就顺延，不阻塞开发（开发主力是夹具单测，离线） |
| 测试期间对真站的访问量 | 每站每轮 1–2 次请求 + 随机间隔，远低于人工浏览；开发探索在 dev-* 空间 |
| 夹具/标定文件含敏感内容 | 只保存公开公告字段，不含任何账号、凭据 |
| stdin 方式不支持跨文件 import | Phase 1 开头先 spike，备选拼接方案 |
| 并行期新旧双发 | V1 生产、V2 shadow（notify: false）互不发包；切换按「差异处置 → 交集键 baseline → 停 V1 → 开 V2 通知」顺序执行（§4.4） |
| ego 能力与文档描述不一致 | 每项依赖 ego 的能力在对应阶段先小范围验证 |
| 电脑关机或注销导致漏跑 | 任务计划「错过后尽快运行」+ 日报计划/实际轮次 + watchdog |
| ego 自动升级后 CLI 协议或行为变化 | 固定版本或延后升级；runs 表记录 ego 版本号；升级前先在 dev-* 空间验证再进生产 |
| ego 任务空间数量超预算（bid-*/dev-* 随站点增长） | 临时空间 finish({keep:false}) 回收；空间清单写入日报观测 |

回滚：每阶段一个 git tag；Phase 1 并行期保留 v1 入口；任一阶段出问题，可退回上一个 tag 并重新启用旧任务。回退到 v1 不再用 --baseline 重建 seen.json——那会吞掉 V2 里待通知的公告，且 v1/v2 去重键格式不同。改用 tools/export_seen.py 反向导出：从 bid.db 取 notified_at 非空的键，优先经 legacy_seen_map 映射还原原 v1 键（§4.4 导入时保存），映射缺失的 V2 期间新键按 v1 键规则生成，无法可靠转换的进异常清单人工处理——**不静默生成看似合法的新键**；notified_at 为空的待通知项不写入 seen.json——v1 首轮会把它们判为新公告正常送出（自动补发，宁重勿漏）。已知限制：回退仅覆盖原 3 站，V2 期间新接入站点的监控随回退暂停（可用 §0.6 手动轮顶）；信息变更类（revision_hash 变化）公告在 v1 中会作为新键再发一次，属可接受重复。

## 8. 建议的推进节奏

1. C1/C2（审阅清单仅存的人工事项）：改密码、转私有、清历史、收敛凭据副本——先做，且为施工门禁（未完成不进入 0.1 及之后任何施工）。
2. Phase 0（3–4 天）跑满 3 天演练。
3. Phase 1（8–12 个有效工作日，无 Docker 依赖；并行观察 3 天另计）：spike stdin import → SQLite/schema/适配器接口（含时间窗规则、测试隔离开关、覆盖缺口记录与 --backfill）→ 录 3 站夹具与标定 → 单测与标定回归全绿 → 并行 3 天（V1 生产/V2 shadow）后按序切换。
4. Phase 2 开头实测表（决定接几个站、接哪些、Phase 3 要不要做）可在 Phase 1 期间并行完成。
5. 第六轮为一致性修订与交付清单冻结；按评审结论停止泛化评审、进入施工。Phase 1 开工前三件定稿——outbox 快照结构、适配器运行契约（run_id + 翻页元数据）、legacy_seen_map——已在本文定案，施工中变更走 git 提交记录。第七轮终审（2026-10-26，「有条件开工 Phase 0」）的开工条件已全部回写：P1-1 生产独立 worktree（ebid-prod，runner 拒跑脏树）、P1-2 分触发类型锁策略（main 等锁 20 分钟→deferred 退出码 4）、P1-3 watchdog 成功口径（main+prod+全站+退出 0/2）、P1-4 revision_hash 入库前字段级合并、P1-5 outbox 建行/重试/过期规则、P1-6 shadow 时序（import_seen 提前 + V1 发送证据 v1_sent.jsonl + 切换日三步）、P1-7 容量测量并入 Phase 1 开头 spike；P2/P3（09:40 上限 80 分钟、锁记 pid、replay 夹具位置 tests/fixtures/replay/、写库工具取锁、异常清单限 FRESH_DAYS、退出标准第 7 条、content_hash 归位 §5.3、shadow 错峰、schedule.json 三类任务、示例 JSON 与目录树补全等）一并落。**开工条件就此关闭：C1/C2 门禁 → Phase 0 施工。**

## 9. 原需求追踪矩阵（阶段完成 ≠ 原需求全部完成）

范围缩减与暂缓以此表为签认记录；Phase 1 开工时随实际决策更新。

| 原需求 | 当前决策 | 阶段 | 验收证据 | 变更/暂缓原因 |
|---|---|---|---|---|
| R1 覆盖扩展：8 平台全接入 | 按公开可见性与公告量实测决定接入数；未接与暂缓站维护在 docs/site_matrix.md 未覆盖清单，月巡检 | Phase 2 | 实测表 + 每站灰度记录 + 未覆盖清单 | 范围缩减：不为扩展而扩展；若增量集中在登录类回 §6 重评 |
| R2 登录自动化分级 | 保留但先过决策门（90 天增量、会话寿命、人工介入频率三问） | Phase 3 | 决策门数据 + 会话寿命实测记录 | 不满足即不做，防为自动化而自动化 |
| R3 凭据安全（DPAPI） | 不变，且提前到 Phase 0（SMTP 授权码即用） | 0/3 | secrets.dpapi 不进 git + check_redline | 无变更 |
| R4 可靠性：waitFor* 替代固定 sleep、单站隔离、重试告警、超时熔断 | 全保留；waitFor* 的验收本轮起明确 | 0/1 | check_redline 增查适配器无裸 sleep（注释说明的退避除外）+ 时序夹具单测 + 超时熔断演练 | 无变更 |
| R5 及时性 ≤2 小时 | 放松为每日 2 轮，最坏 18h、平均约 7.5h；临近截标手动加查 | 已定（§5.4） | 频率计算记录 | 单机资源、反爬、单人维护权衡；已签认 |
| R6 通知：邮件保留、同条不重复 | 不变并增强：outbox 成功门控、跨来源（publisher）只通知一次 | 0/1 | outbox 表 + 双通道故障演练 + 跨源去重用例 | 无缩减 |
| R7 可维护：适配器模式 | 不变并增强：统一 JSON Schema 契约 | 1 | schema 校验 + 每站夹具单测 | 无变更 |
| R8 观测：每轮结构化报告 | 不变并增强：runs/site_runs/coverage_gaps 落库，日报呈现 | 0/1 | runs.jsonl → SQLite 迁移 + 日报 | 无变更 |
| Q10 详情快照 + 全文检索 | 顺延：正文只匹配不入库，notices 留扩展位；正文/附件版本哈希（content_hash）Phase 2 随 §5.3 试点落地 | 待定 | — | 价值待 Phase 2 正文召回实测后重评 |
