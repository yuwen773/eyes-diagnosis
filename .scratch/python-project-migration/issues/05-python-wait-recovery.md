# 05 — 现有 Python 任务升级与重启恢复

**What to build:** 在升级后的库与 Python 身份上恢复既有质量复核、最终复核、保存确认和聊天补充等待，保留输入、checkpoint、来源与原批准绑定。

**Blocked by:** 02 — Python 登录鉴权与前端接线。

**Status:** ready-for-human

**内部实施顺序:** 按四类等待分组验证，保留各自证据；图版本不兼容不能用重跑或丢弃任务替代恢复。

**Acceptance criteria:**

- [x] 为质量复核、最终复核、保存确认和聊天补充分别保存升级前等待样本；经升级与 API/Worker 进程重启后，通过真实身份继续处理。
- [x] 验证诊断图导出结构/hash/action 与独立聊天补充版本兼容；不兼容明确失败，不自动重跑模型、换状态或丢弃 checkpoint/pending writes。
- [x] 原用户、版本、冻结 AI 来源及批准内容仍绑定正确；医生复核不替代保存授权，过期批准和重放不导致重复正式记录。
- [x] 通过状态/历史/SSE 与浏览器刷新观察原任务，不因新登录态、断连或租约恢复产生重复任务；租约、fencing 和事务证据来自真实 MySQL。

**Verification:** 升级前等待 → 真实 MySQL → API/Worker 跨进程重启 → HTTP/SSE/UI；四类等待单独报告。

**Spec:** [完整去 Java 的 Python 项目迁移](../spec.md)。

**Acceptance mapping:** Q2、Q5、Q7、Q10。

**Worktree:** `D:/Work/code/eye-diagnosis/.claude/worktrees/py-rewrite`，分支 `worktree-py-rewrite`。

**Verification status:** PASS_WITH_LIMITATIONS — 4/4 判据在支持范围完成；真实 MySQL/Redis、TCP API/Worker 与原 Vue 恢复专项 11 通过；Windows Web 全量 797 通过、40 跳过，相关回归 94 通过、5 跳过；前端构建及 49 项测试、6 文件 mypy、133 包依赖检查及冻结基线通过。双轴复核最终均 0 项。真实模型/供应商、临床、物理桌面、Linux 全量/部署及生产切流未验收。

## 实施与验收记录（2026-10-16，Asia/Shanghai）

- 实现与重现：[现有 Python 等待任务升级与重启恢复](../../../docs/python-wait-recovery.md)。
- 最终汇总：[verification-summary.json](../evidence/issue05/verification-summary.json)。
- 双轴复核：[review.md](../evidence/issue05/review.md)；追加发现的文档隔离范围表述已修正并独立复核关闭。
- 四份等待样本由固定提交 `cf31e88` 生成，保存输入、checkpoint/pending writes 原始字节及 SHA256、原版本/来源/等待与审计；经纯 Python 升级及真实身份重新登录继续原任务。各类任务原推理/解释各一次；并发 6 路批准只保存一次；过期确认不写入。
- 保存确认新增 version/hash/action 不兼容的 HTTP 409 边界，保留 PENDING 内容；主图和补充图不兼容的真实 MySQL 全表摘要保持。租约故障含旧 Worker 返回与终止两种路径，令牌轮换、fencing 递增及 NOWAIT 事务检查通过。
- 四种 Vue 页面升级后刷新保留原等待，状态/历史/SSE 指向原任务。恢复主路径子进程在无效 JAVA_HOME、空 PATH 下运行；额外故障 executor 单独作为 MySQL fencing 证据。
- 本次仅实施并提交工单 05，不 push，不启动工单 06–08；不升级业务库、切流或删除 Java/冻结 SQL。ready-for-human 不代表真实模型、临床或最终无 JVM 项目验收。

## Constraints

- 依赖工单完成后方可实施；ready-for-agent 表示定义就绪，不代表当前无阻塞或验收通过。
- 兼容优先，旧缺陷另列；医生复核、冻结 AI 来源与用户保存授权分别保留。
- 不清理业务数据、原有运行文件或他人修改；原 spec、旧迁移记录与证据保留历史身份。
- 原 Java 活跃资产保留到工单 08 的前置替代能力与切换演练通过；由 08 执行受控移除并重新验收，不由前置工单提前删除。
- 在隔离环境验证，不默认执行真实业务库升级、生产切流、远端发布或推送；受控、真实基础设施、真实模型/供应商及临床结果分开报告。
