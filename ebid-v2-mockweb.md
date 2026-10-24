# 自建测试 WEB（mock 站点）专项规划

- 从属：[ebid-v2-implementation-plan.md](ebid-v2-implementation-plan.md) §4.5 的独立化文档（含 2026-10-24 审阅 A/E 修订）
- 用途：Phase 1 开头的施工蓝本。适配器开发、调试和回归都对着本机 Docker 里的 mock 站点进行，不再每次访问真实站点，避开反爬和频率问题。
- 排期：Phase 1 开头先搭骨架（约 2–2.5 天，含 Docker 环境），之后所有适配器工作都依赖它。

## 1. 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 运行方式 | Win11 + Docker Desktop（WSL2 后端）+ docker-compose | 环境一条命令重建，依赖固定在镜像里，不污染本机 Python；ego 和 run_check.py 仍在 Windows 主机上跑，只有 mock 在容器里 |
| 服务框架 | Python 3.12 + Flask + Jinja2，镜像基于 python:3.12-slim | 能做模板页、POST 接口、延迟和场景切换 |
| 数据与状态 | mockweb/sites/<站点>/ 下的 JSON + HTML 模板，由真站公开页面快照整理而来；场景状态放内存，重启即复位 | 页面结构贴近真站；不需要数据库或 redis（见 §2） |
| 端口 | 宿主机 127.0.0.1:18080 → 容器 8080 | 只对本机开放，不暴露到局域网 |
| 启停 | docker compose up -d --wait / down，封装为 scripts/mock.cmd；pytest 的 E2E 用例用 fixture 自动启停 | 测试不依赖手工起服务 |
| 环境切换 | config/sites.mock.json 把各站基址指向 mock；环境变量 BID_ENV=mock 选用它；浏览器空间用 test-* 命名 | 与 bid-*、dev-* 空间隔离，cookie 不串 |

后备：若公司电脑策略禁用虚拟化或 WSL，这套方案跑不起来，此时退回裸跑 Flask（保留 python -m mockweb 入口）。

## 2. 服务组成

mock-web 是唯一必需的服务，docker-compose.yml 组织如下：

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

- mockweb/Dockerfile 基于 python:3.12-slim，把 mockweb/ 复制进镜像的 /app，用 flask run --host 0.0.0.0 --port 8080 启动；容器内监听全部网卡，宿主机一侧由端口映射限制为回环地址。不开 FLASK_DEBUG：热更新统一交给 compose watch 的 sync+restart，同时避开 Werkzeug 交互调试器这个任意代码执行入口。
- 不需要数据库或 redis：状态只有当前场景开关和请求计数，单人使用，重启复位反而是优点；站点数据是只读的 JSON 和模板，要长期保留的场景写成 mockweb/scenarios/*.json 随仓库管理。
- mailpit：日常按需 `docker compose --profile mail up -d` 启用，测 SMTP 备用通道、查看告警和日报邮件样式；E2E（pytest -m e2e）强制启用该 profile 并把 SMTP 指向 mailpit，通知类断言全部落在 mailpit 收件上；agently 通道在 E2E 下用环境开关禁用或替换为假 CLI，以模拟「agently 与 SMTP 双失败」演练。webhook 接收桶 /__sink 内置在 mock-web 里，不单独起服务——webhook 通知暂不实施，仅作将来通道预留。
- 容器不需要出网，也不要挂载 data/、ego 配置目录、凭据文件或 docker.sock。
- 端口放在 .env 的 MOCK_PORT（默认 18080）；仓库里只提交 .env.example。

## 3. 接口约定

### 3.1 管理与接收接口（均要求 token）

所有 `/__admin/*` 与 `/__sink/*` 接口要求固定 token 参数（存 .env，脚本与用例从环境变量读取），防止本机其他进程或网页直接 GET 改场景、复位状态，污染正在跑的用例。

| 接口 | 作用 |
|---|---|
| GET /__health | 健康检查（无需 token），mock 环境下 run_check.py 启动时先请求它，失败直接退出并提示先启动 mock |
| GET /__admin/scenario?site=&lt;站点&gt;&mode=&lt;模式&gt; | 切换场景，不重启服务 |
| GET /__admin/reset | 全部复位为 normal |
| POST /__sink/webhook | 接收 webhook 内容并可按场景返回失败（将来通道预留） |

场景也可写 mockweb/scenarios/*.json 随仓库管理。

### 3.2 与 config/sites.mock.json 的配合

- 文件里所有基址都写成 `${MOCK_BASE}/<站点>/`，MOCK_BASE 默认 http://127.0.0.1:18080，由 core/config.py 加载时展开环境变量。端口只在 .env 的 MOCK_PORT 和 MOCK_BASE 这两处出现，scripts/mock.cmd 启动时根据 MOCK_PORT 生成 MOCK_BASE，避免两处不一致。
- BID_ENV=mock 时加载 sites.mock.json，适配器的 URL 白名单只含 MOCK_BASE；生产加载 sites.json，白名单不含任何本机地址，由 check_redline.py 检查。
- ego 和 run_check.py 都在宿主机上跑，所以直接访问 127.0.0.1:18080，不需要进容器网络；容器也不会反过来访问宿主机。
- 分工：sites.mock.json 只描述「去哪里访问」，场景开关描述「mock 怎么响应」，场景通过 /__admin 接口切换，不写进 sites.mock.json。

## 4. 要 mock 的页面和接口

| 对象 | mock 内容 | 用来测什么 |
|---|---|---|
| 国能E招 | 三类公告（招标 001002 / 非招标 001003 / 变更 001004）的 moreinfo、2、3 页列表，链接与标题属性格式同真站；详情页 | 静态抓取的正则、翻页、关键词过滤 |
| 华电 | 外层页 + iframe 内搜索列表（iframepage4，ggbt 关键词参数）；iframe 可延迟加载；标题可带「…」截断 | waitFor* 替代固定 sleep、iframe 时序、标题清洗与去重键 |
| 大唐 / 犀维 | 同源页面 + 公开 POST JSON 接口（三类公告 × 关键词，分页） | page.fetch() 通道、接口字段映射 |
| 通用站点模板 | 由配置生成「列表页 + 详情页 + 可选站内搜索」 | Phase 2 每个新站先在 mock 里落地 |
| 登录页（Phase 3） | 账密页、图形验证码页、带 TTL 的会话 cookie、未登录跳转 | sessionAlive、relogin、handOff |
| 通知接收桶 | 邮件落 Mailpit 容器（E2E 强制启用、SMTP 指向它）；/__sink/webhook 仅作将来通道预留（webhook 通知暂不实施），可按场景返回失败 | 重试、SMTP 备用、告警与日报内容 |

## 5. 场景模式

数据可固定，发布日期按「今天」相对生成，用来测 FRESH_DAYS。

| 模式 | 行为 | 对应的用例 |
|---|---|---|
| normal | 正常列表，含若干 AVC/AGC 与无关公告 | 基线、去重 |
| empty | 列表为空 | raw_count 为 0 告警 |
| error5xx / timeout | 返回 500 或长时间不响应 | 单站失败隔离、连续失败告警、分站超时与进程清理 |
| layout_changed | 改变 DOM 结构或 URL 格式 | 改版检测与夹具单测 |
| truncated_titles | 标题被「…」截断且每轮不同 | title_norm 与 dedupe_key 稳定性 |
| changed_notice | 同一公告出现变更公告、截止时间变化 | 变更公告作为新事件 |
| poisoned | 标题含提示注入文字、控制字符、超长文本，详情含指向非白名单域名的链接 | 字段清洗、URL 白名单、红线 |
| session_expired / captcha | 会话到期、要求验证码（Phase 3） | 降级为公开采集、告警邮件、relogin |

## 6. Windows + Docker Desktop 注意事项

- WSL2 后端：Win11 上 Docker Desktop 默认用 WSL2，需要 BIOS 开启虚拟化并已装好 WSL2。
- 文件挂载：代码在构建时复制进镜像，开发时靠 docker compose watch 同步，不依赖把 Windows 目录 bind mount 进容器——那条路径经过 WSL2 跨文件系统，速度慢，文件变更事件也不可靠。只读挂载的 tests/fixtures 体积小，可以接受。compose 里一律写相对路径 ./…，不写 C:\…；仓库留在 C:/work/ebid，不必搬进 WSL。
- 换行符：加 .gitattributes，让 *.sh 等容器里要执行的文件强制 LF，避免 CRLF 导致容器内脚本报错。
- 开机自启：建议关闭 Docker Desktop 的「登录时启动」，容器统一 restart: "no"。测试前手动打开 Docker Desktop；E2E 的 fixture 发现 Docker 或 ego 任一没就绪时直接报错并提示，不静默跳过。
- 生产链路不依赖 Docker：任务计划程序 → run_check.py 全程不碰容器；tools/check_redline.py 增加一项检查，生产路径里不得出现 docker 调用。
- 资源：Docker Desktop 的 WSL2 虚拟机空闲时也占内存；在用户目录的 .wslconfig 里设置内存上限（例如 2GB），给 ego 浏览器留足空间。
- 端口：Hyper-V 可能保留一段端口，冲突时用 `netsh int ipv4 show excludedportrange protocol=tcp` 查看，并改 .env 里的 MOCK_PORT。配置里一律写 127.0.0.1，不写 localhost，避免解析到 ::1 带来的不确定性；绑定回环地址也不会弹出 Windows 防火墙提示。
- 许可：Docker Desktop 个人和小型企业通常免费，较大企业需要付费订阅；在公司电脑上用之前先确认。

## 7. 开发调试流程

1. 首次：`docker compose build`，再 `docker compose up -d --wait`，等健康检查通过；访问 http://127.0.0.1:18080/__health 确认。
2. 日常改 mock（页面模板、站点数据、场景 JSON、Flask 代码）：另开一个终端跑 `docker compose watch`，改动自动同步进容器并重启 mock-web，几秒内生效。
3. 改 requirements.txt 或 Dockerfile：watch 会自动重建；没开 watch 就 `docker compose up -d --build`。Docker Desktop 版本太旧不支持 watch 时，也用这一条。
4. 只想切换场景：不用重启，运行时调 `curl.exe "http://127.0.0.1:18080/__admin/scenario?site=chd&mode=empty"`（带 token）；`/__admin/reset` 全部复位为 normal。（PowerShell 里的 curl 是别名，要写 curl.exe。）
5. 看日志：`docker compose logs -f mock-web`；进容器排查：`docker compose exec mock-web sh`。
6. 跑回归：`pytest -m e2e`。fixture 先探测 Docker 与 ego 就绪（ego 用 ego-browser --version），再 `docker compose up -d --wait --profile mail`，设置 BID_ENV=mock 和 MOCK_BASE，用例结束默认 `docker compose down`；调试时加 --keep-mock 保留容器。
7. 收工：`docker compose down`。

## 8. 各阶段接入方式

- Phase 0：不依赖测试 WEB，先快速止血。
- Phase 1：开头搭骨架并覆盖现有 3 站，再重构适配器。tests/e2e/ 用 docker compose 起 mock、设 BID_ENV=mock，跑完整的 run_check.py，断言入库条目、通知内容和告警（通知断言落在强制启用的 mailpit 收件上，agently 通道用开关模拟失败）；把 Phase 0 的四项演练改写成自动化用例。E2E 会真实驱动 ego，较慢，用 pytest 标记 e2e 单独跑：每次改适配器后、发布前各一次。
- Phase 2：每个新站先录制公开页面快照，在 mock 里加对应站点，对着 mock 写适配器、补用例，最后只对真站做 1–2 次冒烟。
- Phase 3：加登录与会话失效 mock。

## 9. 边界与安全

- mock 无法复现瑞数的动态反爬、真实网络延迟和真站改版，这些仍靠真站冒烟和运行时的 raw_count 告警覆盖；不要把「mock 全绿」当成「真站可用」。
- 快照只取公开页面内容，不放任何真实账号、密码、证书口令。
- 生产的 URL 白名单不得包含 127.0.0.1；tools/check_redline.py 增加一项检查：生产配置里不得出现 mock 基址。
- 红线不变：mock 的开发和调试可以借助 AI（人在场），生产定时任务仍只走确定性脚本。
