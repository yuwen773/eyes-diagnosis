# Docker 测试资源生命周期审计与整改

- 日期：2026-11-19
- 基线：`master`（2026-11-21 重做到 master 上；原始审计基于 `feat/r3-agent-correctness` @ `03932ab7`）
- 范围：本仓库所有会创建/消费 Docker 资源的测试入口（本机 + CI）
- 结论：历史泄漏根因已定位并用可控实验复现；测试入口已统一到带 Run ID / 所有权标签
  的生命周期 harness；新增成功、失败、超时、中断、并发、重复运行六类回收验收；
  历史资源只盘点、默认 dry-run，不做全局 prune。

> 本机是共享主机：审计期间另有一个进程/会话在并发清理 Docker（全局卷数在一次读取
> 之间从 **379** 掉到 **46**，可回收卷从 **41.56 GB** 掉到 **2.78 GB**）。因此下文
> 的资源数字都带时间点；整改验收以 **本次 run-id 作用域** 为准，不用全局数字冒充。

---

## 1. 根因分析

### R1. `docker rm -f` 不删除匿名卷（主因）

`mysql:*` 与 `redis:*` 官方镜像都在镜像元数据里声明了 `VOLUME`：

| 镜像 | 声明的 VOLUME |
|---|---|
| `mysql:8.0.26` / `mysql:8.0.36` | `/var/lib/mysql` |
| `redis:7-alpine` / `redis:7.2.4` | `/data` |

当 `docker run` 没有显式挂载这两个路径时，Docker 会为每次运行创建一个**匿名卷**
（64 位十六进制名）。`docker rm -f` 只删容器，**不会**删匿名卷；只有 `docker rm -v`
或 `docker run --rm` 才会。旧 `scripts/verify.sh` 用的是：

```bash
docker run -d --name "$CID" ... "$MYSQL_IMAGE"   # 无 -v
cleanup() { docker rm -f "$CID" "$REDIS_CID"; }  # 无 -v
```

于是一次 `verify.sh` 至少留下 1 个 MySQL 匿名卷（初始化后约 200–250 MB）和 1 个
Redis 匿名卷。多轮验证、多个工作树叠加，就是历史上 361 个无引用卷、40 GB 量级
空间的主体。

**复现（2026-11-19，已清理现场）**：

```
docker run -d --name leak-demo mysql:8.0.36 sleep 60   # 运行中出现 1 个新匿名卷
docker rm -f leak-demo                                 # 不删匿名卷
→ 匿名卷 ...89fa4a7 仍然存在（removed count: 0）
```

**整改后同一动作**：命名卷 + 标签，teardown 先 `rm -f -v` 再按标签删命名卷 →
`new volumes after teardown: 0`。

### R2. 运行中断/超时/被 kill 时清理不保证

旧脚本只有 `trap cleanup EXIT INT TERM`。终端关闭、CI 取消、`kill -9`、断电、
或宿主重启时 trap 不执行，容器连同匿名卷变成孤儿。命名容器名只带 PID
（`eye-diagnosis-verify-$$`），不同会话之间无法判断归属，也不敢自动清理。

### R3. 手工/一次性 `docker run` 没有所有权契约

审计时仍在运行的 `iris-r3-*`、`iris-rc2-chatcheck-*`、`iris-rc-final-rag-*`，
以及已退出的 `eye-draft-mysql` / `eye-admin-*`，都是验收过程中手工 `docker run`
留下的：没有 Run ID、没有 owner 标签、没有统一 teardown。它们和正式开发服务、
其他项目（`ai-interview`、`oncloud-agent`/milvus、VisionSpace `vs45-*`）混在同一台
Docker 里，事后只能靠名字猜归属。

### R4. 镜像与端口策略放大问题

- 旧本地脚本用 `mysql:8.0.26`，CI 用浮动的 `mysql:8.0`，历史上还用过
  `mysql:8.0.36`、`redis:7-alpine`、`redis:7.2.4`：同一宿主上多份同名不同 tag 的
  大镜像，且浮动 tag 让 CI 不可复现。
- 固定宿主端口 `33306/36379` 让并发验证互相踩端口，失败后更容易留下半启动容器。
- 旧的 compose 有 `version: '3.8'`（Compose v2 已废弃）且没有显式的 project name
  与保护标签，清理工具无法把“持续开发服务”与“测试资源”分开。

---

## 2. 测试入口清单（整改前 → 整改后）

| 入口 | 类型 | 镜像策略 | 资源 | 失败/中断清理 | 整改 |
|---|---|---|---|---|---|
| `scripts/verify.sh` | 本地后端全量验证 | 固定 tag，未固定 pull | `docker run` MySQL + Redis，固定端口，无卷 | `trap` + `rm -f`（漏匿名卷） | 接 harness：Run ID、owner 标签、命名卷、随机端口、`rm -f -v`、结束断言无残留 |
| `docker-compose.yml` | 持续开发服务（Chroma） | `ghcr.io/chroma-core/chroma:1.0.0` | 命名卷 `chroma-data`（持久） | `docker compose down` 保留卷 | 加 `name`、`pull_policy: missing`、`eye.owner/kind/protected` 标签；明确 PROTECTED_DEV |
| `.github/workflows/verify.yml` `backend-unit` | CI 服务容器 | `mysql:8.0` + `redis:7-alpine` + chroma | runner 自管 service containers | runner 自动回收 | 钉到 `mysql:8.0.36` / `redis:7.2.4`，与本地/镜像清单一致 |
| `.github/workflows/verify.yml` `flyway-mysql` | CI 服务容器 | `mysql:8.0` | runner 自管 | runner 自动回收 | 钉到 `mysql:8.0.36` |
| `.github/workflows/verify.yml` `docker-lifecycle`（新增） | 资源回收门禁 | `busybox:1.36`（+可选 mysql） | 每次唯一 Run ID | 六类退出路径验收 | 新增 |
| `docs/plans/2026-04-23-agentic-rag.md` 手工命令 | 文档示例 | `chroma:1.0.0` | `--rm` | `--rm` 会删匿名卷 | 无需改代码；文档标注优先用 compose |
| 手工验收（`iris-*`、`eye-*` 容器） | 一次性 | 混用 | 无契约 | 无 | 纳入下文回收方案；以后用 harness |

其他目录（`frontend/`、`web/scripts/evidence/`、`algorithm/`）只连本机 MySQL/Chroma，
不创建 Docker 资源；`web/scripts/evidence/fixture-diagnosis.mjs` 明确只写 3306 本地
开发库，不碰 3307 / 生产库。

---

## 3. 所有权契约

新增 `scripts/lib/docker-test-harness.sh`，任何测试入口 source 后：

```bash
. "$ROOT/scripts/lib/docker-test-harness.sh"
eye_docker_init            # 生成 EYE_DOCKER_RUN_ID 与标签参数
eye_docker_trap_teardown   # EXIT / INT / TERM / HUP → teardown
eye_docker_require_image "$IMAGE"
eye_docker_volume_create "$(eye_docker_volume_name mysql-data)"
eye_docker_run_named "$(eye_docker_container_name mysql)" -d --mount ... "$IMAGE"
```

每个容器 / 卷 / 网络带三个标签：

| 标签 | 含义 |
|---|---|
| `eye.owner=eye-diagnosis` | 归属项目；清理工具只认这个命名空间 |
| `eye.run-id=<kind>-<utc>-<sha>-<pid>-<rand>` | 单次测试运行唯一标识；teardown/断言只按它过滤 |
| `eye.kind=test\|evidence` | `test` 可自动回收；`evidence` 默认保留供取证 |
| `eye.created-at=<UTC>` | 排障/老化参考 |

另外本地 `.tmp-docker-runs/<run-id>.resources` 记录本次创建的资源名，作为标签
写失败的兜底。

**teardown 只做三件事**：按 `label=eye.run-id=<id>` 删容器（`rm -f -v`）→ 删卷
（`volume rm -f`）→ 删网络；再读 registry 兜底。**不调用任何 `prune`**，不按镜像名 /
名字通配删除，不碰其他 owner、运行中容器、`eye-diagnosis` compose 项目。

`EYE_DOCKER_KEEP=1` 保留现场（资源仍有标签），供事后人工取证；reaper 能按 Run ID
列出并回收。

**保护必须判在归属之前。** compose 开发服务自己也带 `eye.owner=eye-diagnosis`（见
`docker-compose.yml`），所以分类器要先判 `eye.protected=true` / `eye.kind=dev-service` /
`com.docker.compose.project=eye-diagnosis`，再判 owner。顺序反过来时，「已停止的 dev
容器 + 无引用的持久卷」会落进 `SAFE_STOPPED` / `SAFE_UNHELD` 并被 `--apply-safe` 删掉——
`docker compose down`（不带 `-v`）之后跑一次文档 §6.3 第 3 步就能命中。
2026-11-21 已改为保护优先，并在 `test-docker-reaper.sh` 补了这条反例。

---

## 4. 整改代码

| 文件 | 变更 |
|---|---|
| `scripts/lib/docker-test-harness.sh` | 新增：Run ID、标签、命名卷、teardown、信号 trap、`assert_clean`、MSYS 路径转换规避 |
| `scripts/lib/docker-images.env` | 新增：镜像唯一真源（`mysql:8.0.36` / `redis:7.2.4` / chroma 1.0.0 / busybox 1.36） |
| `scripts/verify.sh` | 重写资源段：标签、命名卷、随机端口、Redis 就绪、结束断言；保留两遍 Maven 编排 |
| `scripts/docker-test-resources.sh` | 新增：只读盘点 + 分类 + `--apply-safe` + `--assert-clean` + `--json`；默认 dry-run |
| `scripts/tests/test-docker-lifecycle.sh` | 新增：成功/失败/超时/中断/并发/重复六类验收 |
| `scripts/tests/fixtures/docker-lifecycle-child.sh` | 新增：生命周期测试子进程 |
| `scripts/tests/test-docker-image-pins.sh` | 新增：镜像版本一致性、harness 接入、禁止全局 prune 的静态契约 |
| `docker-compose.yml` | 去 `version`、加 `name`、`pull_policy: missing`、`eye.*` 标签 |
| `.github/workflows/verify.yml` | 钉镜像版本；新增 `docker-lifecycle` job |
| `.gitignore` | 忽略 `/.tmp-docker-runs/` |

### 镜像复用与 CI 可复现

本地与 CI 统一到：

```
mysql:8.0.36
redis:7.2.4
ghcr.io/chroma-core/chroma:1.0.0
busybox:1.36        # 仅生命周期测试
```

`mysql:8.0.36` / `redis:7.2.4` / chroma 本机当时已有；`busybox:1.36` 不在本机，
第一次跑生命周期 / 回收器验收会拉一次（约 4 MB）。CI 从浮动 tag
`mysql:8.0` / `redis:7-alpine` 改为精确版本，可复现性提高；`test-docker-image-pins.sh`
断言本地清单、CI、compose 三处一致，防止再次漂移。

---

## 5. 验收证据

### 5.1 静态契约（17/17）

```
PASS: CI mysql image(s) = mysql:8.0.36
PASS: CI redis image(s) = redis:7.2.4
PASS: CI chroma image = ghcr.io/chroma-core/chroma:1.0.0
PASS: compose chroma image = ghcr.io/chroma-core/chroma:1.0.0
PASS: verify.sh sources the harness
PASS: verify.sh initializes a run id
PASS: verify.sh installs teardown traps
PASS: verify.sh asserts cleanliness
PASS: CI runs the lifecycle gate
PASS: CI runs the reaper safety gate
PASS: reaper exposes assert-clean
PASS: harness removes containers with -v
PASS: compose pins pull_policy: missing
PASS: compose declares project name
PASS: compose labels owner
PASS: compose labels protection
PASS: no global docker prune in scripts/ or .github/
```

### 5.2 生命周期验收（16/16）

`bash scripts/tests/test-docker-lifecycle.sh`（本机 Windows/Git Bash）：

| 场景 | 结果 | 资源断言 |
|---|---|---|
| 成功退出 | PASS | 无容器/卷/网络残留 |
| 失败退出（rc=7） | PASS | 无残留 |
| `timeout` SIGTERM（rc=124） | PASS | 无残留 |
| SIGINT → 平台延迟时升级 SIGTERM | PASS | 无残留 |
| 3 路并发 + 无关哨兵容器 | PASS | 3 个 run 各自清空；哨兵存活 |
| 连续 3 次重复运行 | PASS | 套件资源 before=0 after=0 |

本机单次 Docker CLI 调用约 1–3 s（Docker Desktop 命名管道），整套约 2 分钟；
CI Linux 上会显著更快。`EYE_TEST_FULL=1` 可额外跑真实 `mysql:8.0.36`
（验证 `/var/lib/mysql` 的 VOLUME 语义）。

### 5.3 回收器安全验收（9/9）

`bash scripts/tests/test-docker-reaper.sh` 构造一个微型宿主状态，验证 `--apply-safe`：

| 资源 | 预期 | 结果 |
|---|---|---|
| 已停止、`eye.owner=eye-diagnosis` 的容器 | 删除 | PASS |
| 该容器持有的命名卷 | 同一轮删除 | PASS |
| 无引用的自有命名卷 | 删除 | PASS |
| 运行中的自有容器 | 保留 | PASS |
| 运行中的其他项目容器 | 保留 | PASS |
| **已停止的 compose 开发服务容器**（`eye.protected=true`） | 保留 | PASS |
| **该开发服务的持久卷** | 保留 | PASS |
| apply 日志中无全局 prune | 是 | PASS |

后两行是 2026-11-21 补的：修复前它们会被判成 `SAFE_STOPPED` / `SAFE_UNHELD` 并删除。
去掉「保护优先于归属」那处改动，这两条立即变红（`PASS=7 FAIL=2`）。

### 5.4 根因对照实验

| 方式 | 运行中出现 | teardown 后新增卷 |
|---|---|---|
| 旧：`docker run mysql` + `docker rm -f` | 1 个匿名卷 | **1 个（泄漏）** |
| 新：命名卷 + 标签 + harness teardown | 1 个命名卷（可归属） | **0** |

### 5.5 后端全量验证

`scripts/verify.sh`（含 `contextLoads` + 两个 MySQL 集成门禁）结果见
`§7 运行记录`。脚本结尾会执行 `eye_docker_assert_clean`；**测试绿不等于回收绿**，
两者分别断言。

---

## 6. 历史资源盘点与安全清理方案（默认 dry-run）

> 数据是 2026-11-19 某一时刻的快照（共享主机，数字会变）。
> 生成命令：`scripts/docker-test-resources.sh`（只读）。
> 清理候选只报告，**不自动删除**。

### 6.1 全局读数

| 时间点 | Volume 总数 | 悬空卷 | 可回收卷空间 | 容器 | 镜像可回收 |
|---|---|---|---|---|---|
| 审计开始 | 379 | 361–367 | 41.56 GB | 21（7 运行） | 9.16 GB |
| 审计中（并发清理后） | 46 | 34 | 2.78 GB | 21 | 9.16 GB |

审计期间另一个进程做了无差别的全局清理。这正说明“谁都能 prune”不可接受：
它可能删掉别人的持久卷，也无法证明删的是测试资源。本方案改为**按标签 + 人工复核**。

### 6.2 分类与处理建议

| 分类 | 数量（快照） | 说明 | 建议 | 可恢复性 |
|---|---|---|---|---|
| `PROTECTED_DEV` | 1 容器 / 1 卷 / 1 网络 | `eye-diagnosis` compose：Chroma 开发服务与 `eye-diagnosis_chroma-data` | **禁止删除** | — |

> 这张表是**加 `eye.*` 标签之前**的快照。标签加上以后，同一条 compose 服务会先命中
> `eye.protected` / `eye.kind=dev-service` 分支，仍然归 `PROTECTED_DEV`——前提是分类器
> 把保护判在归属之前（2026-11-21 修复，见 §3）。
| `ACTIVE_OWNED` | 本次 verify 的 2 容器 / 2 卷 | 快照时刻恰有一次 verify 在跑 | 运行期不删；teardown 自动清 | — |
| `SAFE_STOPPED` / `SAFE_UNHELD` / `SAFE_DANGLING` | 0 | 带 `eye.owner=eye-diagnosis` 且已停止/无引用 | 可 `--apply-safe` | 重跑测试即可重建 |
| `REVIEW_LEGACY_RUNNING` | 7 | `iris-r3-*`、`iris-rc2-*`、`iris-rc-final-rag-*`，无标签但在跑 | **先确认使用者**；不要盲删 | 重跑验收可重建 |
| `REVIEW_LEGACY_STOPPED` | 3 | `eye-draft-mysql`、`eye-admin-chroma`、`eye-admin-redis` | 人工确认后删；删容器用 `-v` | 重跑可重建 |
| `REVIEW_LEGACY_EYE` 卷 | 30 | `eye-compose06-*`（18）、`eye-ci-mysql06-final`、`eye-closeout08-*`（2）、`eye-linux-real06-runtime`、`eye-mysql08-final-data`、`local-preview_*`（2）、`pr-12-hardening_*`（5） | 确认无证据用途后批量删；约 2.3 GB | 重跑测试/重建 compose 可恢复 |
| `REVIEW_ANON` 卷 | 13 | 64 位匿名卷；其中 3 个无引用且约 200–252 MB，是 R1 的直接产物 | 优先处理无引用的；有宿主的随容器处理 | 仅测试态，可弃 |
| `REVIEW_LEGACY_EYE` 网络 | 6 | `eye-compose06-*`，无端点 | 确认后删 | `compose up` 可重建 |
| `OTHER_PROJECT` | 10 容器 / 5 卷 / 2 网络 | `ai-interview`、`oncall-agent`/milvus、`vs45-*`（VisionSpace） | **禁止删除** | — |
| `SYSTEM` | 3 网络 | `bridge` / `host` / `none` | **禁止删除** | — |
| `REVIEW_LEGACY_EYE_IMAGE` | 5 | `eye-verify:closeout08` 2.96 GB、`eye-verify:ticket08` 2.96 GB、`eye-python-cpu:ticket06` 4.51 GB、`pr-12-hardening-*` 0.85 GB | 仅报告；确认后可 `docker image rm`；约 11.3 GB | 可重新构建/拉取 |

### 6.3 安全操作顺序

```bash
# 1) 只读盘点（默认 dry-run）
scripts/docker-test-resources.sh

# 2) 只看某一个历史 Run / 本次保留的现场
scripts/docker-test-resources.sh --run-id <run-id>

# 3) 回收“明确属于本仓库且已停止/无引用”的新契约资源
scripts/docker-test-resources.sh --apply-safe

# 4) 历史 REVIEW_* 资源：先人工确认，再按精确 ID/名字逐个删除。
#    不提供自动批量删除；更不要用 docker system/volume prune。
```

历史卷的人工删除示例（**确认后**执行，逐条）：

```bash
# 先看持有人，确认没有运行中的容器
docker ps -a --filter volume=eye-compose06-5bea0366075b-mysql
# 无持有人才删
docker volume rm eye-compose06-5bea0366075b-mysql
```

**明确不要在共享主机上执行**：`docker system prune -a`、`docker volume prune`、
`docker container prune`、`docker network prune`。这些命令不区分 owner，会波及
正式开发库、其他项目与需保留的取证容器。

---

## 7. 运行记录

### 7.1 后端全量验证

2026-11-21，master `280f45c9`，本机 Windows 11 + Docker 29.2.1，命令 `bash scripts/verify.sh`：

- 环境：一次性 `mysql:8.0.36` + `redis:7.2.4`，随机宿主端口 54569 / 54567，
  run id `test-20261121t132551z-280f45c9-26692-7df4`
- pass 1：`Tests run: 809, Failures: 0, Errors: 0, Skipped: 303`，BUILD SUCCESS
  （跳过的 303 条就是 pass 3 的隔离库套件——它们的门禁是环境变量，pass 1 里没给）
- pass 2：MySQL 集成门禁，`Tests run: 10, Failures: 0, Errors: 0`，BUILD SUCCESS
- pass 3：隔离库协作套件，`Tests run: 303, Failures: 0, Errors: 0`，BUILD SUCCESS
- 结束断言：`clean: run test-20261121t132551z-... has no leftover containers/volumes/networks`
- 退出码 0，`==> verify green`；`.tmp-docker-runs/` 无残留记录

> 2026-11-19 的首次验收（270 + 4 条）是在只有两遍的旧编排上做的，数字随 master
> 增加了第三遍而变化，故以本行为准。

> 第一次运行曾失败：harness 最初全局导出 `MSYS2_ARG_CONV_EXCL=*`，连带让 Maven
> 启动器的 MSYS classpath 不再转换，报 `ClassNotFoundException: ...Launcher`。
> 已改为只用一个 `docker()` 包装函数、仅作用于 docker 调用；第二次通过。
> 这不是 Docker 资源问题，而是 Windows 路径转换的作用域问题，记录在此避免复发。

### 7.2 三套专项验收（最终代码）

| 命令 | 结果 |
|---|---|
| `scripts/tests/test-docker-image-pins.sh` | **17/17** |
| `scripts/tests/test-docker-lifecycle.sh` | **16/16** |
| `scripts/tests/test-docker-reaper.sh` | **9/9** |

### 7.3 本次运行后的残留

`docker ps -a --filter label=eye.owner=eye-diagnosis` 只应看到仍在正常运行的
非测试容器；本次 verify / 生命周期 / 回收器的 run-id 资源均为 0。验收命令：

```bash
scripts/docker-test-resources.sh --assert-clean --run-id <run-id>
```

---

## 8. 残余风险

1. **共享主机 / 并发 agent**：审计期间已观测到另一个进程在全局清理。未加标签的
   历史资源无法证明归属，reaper 只报告不删除；需要人工按 allowlist 处理。
2. **`kill -9` / 断电 / 宿主重启**：任何 trap 都无法执行。缓解：所有新资源带
   Run ID + owner 标签，恢复后用 `scripts/docker-test-resources.sh` 按标签回收；
   不要用全局 prune。
3. **仓库外的手工命令**：终端里直接 `docker run` 不受 harness 约束。约定：一次性
   服务一律用 harness 或 compose；手工容器至少带 `--label eye.owner=eye-diagnosis`
   与 `--rm`（若无需取证）。
4. **镜像缺失 / 离线**：`--pull=missing` 只复用本地；若本地镜像被清掉，离线运行会
   失败。此时显式 `EYE_DOCKER_PULL=never` 会给出清晰报错，而不是静默拉取。
5. **Docker Desktop 自身 GC**：本机观察到卷数骤降，可能来自 Docker Desktop 或
   其他会话；不由本仓库控制。验收指标因此按 Run ID 作用域统计。
6. **CI 服务容器**：由 GitHub runner 管理并随 job 回收，不在本方案治理范围内；
   镜像已钉版本以保证可复现。
7. **证据保留**：`EYE_DOCKER_KIND=evidence` + `EYE_DOCKER_KEEP=1` 的资源不会被
   自动回收；reaper 会列为 REVIEW/ACTIVE，需人工判断。

---

## 9. 不做的事（边界）

- 不对用户全局 Docker 执行任何 prune。
- 不删除正式开发数据库、`eye-diagnosis_chroma-data`、其他项目（`ai-interview`、
  milvus、VisionSpace）的资源。
- 不自动删除历史 `REVIEW_*` 资源；只给候选、来源、大小、风险与可恢复性。
- 不创建新工作树、不重置他人修改；本文件与代码都在当前基线工作树内。
