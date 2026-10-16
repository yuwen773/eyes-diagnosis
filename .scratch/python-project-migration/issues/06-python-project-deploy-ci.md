# 06 — Python 工程、双环境部署与无 JVM CI

**What to build:** 提供根目录 Python 工程、Windows 本地脚本及 Linux Compose；将活跃测试与验收入口切换到独立契约和 Python 服务，在干净无 JVM 环境验证完整交付。

**Blocked by:** 03 — 非 JVM 文档解析与知识库闭环；04 — 旧版任务查看与显式关联重建；05 — 现有 Python 任务升级与重启恢复。

**Status:** ready-for-human

**内部实施顺序:** 先打包并完成运行冒烟，再切换源码契约测试与 CI；部署与 CI 共用同一交付入口，分别保留运行和验收结果。

**Acceptance criteria:**

- [x] 根目录工程元数据、锁定依赖和开发入口明确，保持现有模块路径与恢复兼容；Windows 使用 PowerShell 7 的启动/停止步骤可验证。
- [x] Linux 容器固定 Python、解析工具与应用依赖，构建/运行不含 JVM；Compose 区分 API/Worker 和前端入口，支持连接既有基础设施。
- [x] 从已验证的空库/旧库承接入口到健康服务、重新登录、数据读取及一个 Worker 任务有可重复演示；重启不丢数据。
- [x] 主 README、项目当前运行指引、配置样例和健康检查与交付一致；不自动清空库/向量/对象，不打包运行秘密、业务数据或原有未提交文件。
- [x] 原 Java 源码/配置/callback 路径读取测试改用独立契约与迁移资产；并发、恢复、真实服务验收入口不用 JDK/Maven/Flyway/Tika。
- [x] 活跃 CI 不安装/执行 Java；纯 Python 构建、依赖检查、Web 回归、Vue 构建/OpenAPI 及必需浏览器验证按变更范围完成。
- [x] 隔离真实 MySQL/Redis/Chroma + 独立 API/Worker 通过身份、事务、租约/fencing、并发、人工等待、批准后仅一次保存与大 ID 范围隔离。
- [x] 工程与真实基础设施结果独立于真实 embedding/LLM/分类/COS/临床；缺凭据、确定性适配器或供应商失败明确分级，旧工单 19 结果不被改写。

**Verification:** Windows 安装/启动 + 干净 Linux 无 JVM 镜像/Compose + CI 等价执行 + 隔离真实 MySQL/Redis/Chroma 与独立 API/Worker。

**Spec:** [完整去 Java 的 Python 项目迁移](../spec.md)。

**Acceptance mapping:** Q1、Q5、Q7、Q8、Q15。

**Worktree:** `D:/Work/code/eye-diagnosis/.claude/worktrees/py-rewrite`，分支 `worktree-py-rewrite`。

**Verification status:** PASS_WITH_LIMITATIONS — 8/8 工程判据完成，待人工复核；不代表真实模型/供应商、临床、托管 CI 或生产切流通过。

## 实施与验收（2026-10-16）

根目录 wheel/锁定 Python 工程、PowerShell 7 安装及 API/Worker 生命周期、无 JVM Web/CPU/验证镜像、原 Vue/Nginx Compose、独立 JSON/SQL/protobuf 契约及活跃 CI 已交付。迁移为显式入口；原 Java 工程和历史证据保留。

- Windows / Linux 无 JVM Web 全量分别 801 通过、40 跳过；收尾针对性各 37 通过，契约清理后 199 通过，类型检查 6 个模块通过。
- 原 Vue OpenAPI 生成、类型检查与构建通过，Vitest 49 通过；四类人工等待的真实 MySQL/Redis/浏览器恢复 4 通过。
- 两环境真实 MySQL 8.0.26 / Redis / Chroma、独立 API/Worker 主链通过；各有并发 14、人工等待恢复 12、空库/V9/V22 承接 21 通过。模型、embedding、LLM、COS 为明确标注的受控边界。
- 原样冻结 protobuf 生成、CPU 模型模块装载及构造通过；Linux 算法全量 306 通过、1 跳过、16 慢测未选择，独立 watchdog 门禁 28 通过。
- Compose 从空库升级到原密码登录、数据读取、真实 Worker 任务、强制 API 换 IP 后重启保全及原 Vue 浏览器登录通过；Standards / Spec 最终剩余均 0 项。

详见 [验收汇总](../evidence/issue06/verification-summary.json)、[故障定位与环境边界](../evidence/issue06/diagnosis.md)、[双轴复核](../evidence/issue06/review.md)。首轮失败与最终通过分开留存。WSL 时钟仍观察到回拨，生产 ID 保护和宿主时间未改；Docker 的 Ubuntu 集成代理报错未宣称解决。未触发托管 CI、使用真实模型/供应商验收、升级业务库、生产切流或 push；没有启动 07/08。

## Constraints

- 依赖工单完成后方可实施；ready-for-agent 表示定义就绪，不代表当前无阻塞或验收通过。
- 兼容优先，旧缺陷另列；医生复核、冻结 AI 来源与用户保存授权分别保留。
- 不清理业务数据、原有运行文件或他人修改；原 spec、旧迁移记录与证据保留历史身份。
- 原 Java 活跃资产保留到工单 08 的前置替代能力与切换演练通过；由 08 执行受控移除并重新验收，不由前置工单提前删除。
- 在隔离环境验证，不默认执行真实业务库升级、生产切流、远端发布或推送；受控、真实基础设施、真实模型/供应商及临床结果分开报告。
