# 工单 08 收尾预检与复验

日期：2026-10-17（Asia/Shanghai）。工作树 `py-rewrite`，基点 `63931d7bd321b126eb3ee2111af5693e9fce1014`。

本次只读预检结果见 [preflight.json](preflight.json)：历史标签、203 个受控移除路径、24 份冻结 SQL 摘要均通过；活跃实现与已提交验收版本一致。重新运行无 JVM 依赖扫描得到 `PASS`，数据库冻结基线得到 `BASELINE_OK`。

已核对并复用原 Windows 全量（814 通过、43 跳过）、扫描 11 项、旧 Python 等待升级与旧任务重建 12 项、Windows 数据库承接 21 项、Linux 算法回归（306 通过、1 跳过）的 JUnit。以上不是本次重跑，也不替代 Linux 最终 Web 全量或真实基础设施门禁。

初始预检时 Docker 未运行，`preflight.json` 的 `PENDING` 保留当时的授权状态。用户随后明确允许启动 Docker 完成隔离验证；Docker 运行时 socket 故障及备份处理见 [环境记录](environment.md)。原环境完整复验为 808 通过、6 失败、43 跳过，见 `linux-full/web.xml`；没有覆盖旧票失败记录。

用户进一步明确允许临时停止 Ubuntu 时间同步服务，并要求结束恢复；同实现、同测试的串行对照运行在 `after-timesync-stop/` 已完成：Web 814/43、真实服务三个工程 gates 和数据库承接 21 通过，共同入口退出 0。`with_timesync_stopped.py` 用 finally 恢复原 active/enabled 状态，实际结果见 `service-restoration.json`，本次已再次只读确认 active。

工单 08 更新为 `ready-for-human / PASS_WITH_LIMITATIONS`、4/4 工程范围。用户随后要求不再继续 Linux 验收；没有追加运行或重启已不可用的 Docker 引擎。真实服务细分并发日志保留在 `run.json` 所列运行卷，未导出到主机；本地结果以 `services/results.json`、`handoff.xml` 和共同入口成功状态为证，不额外声称本地已有细分日志或虚构计数。

原 `PARTIAL` 机器汇总原字节保存在 `verification-summary-before-closeout.json`；新的总汇见 [verification-summary.json](../verification-summary.json)。Linux 通过条件不代表默认 WSL 的回拨问题已修复。

`run_linux.py` 修复了辅助脚本复核发现的证据覆盖、超时容器残留和清理失败状态问题；既有 `run.json` 的执行拒绝检查通过。当前运行使用安全修正前已加载的辅助脚本，原文留存于 `after-timesync-stop/runner-executed.py.txt`；新安全处理单独静态复审为 0 项剩余问题，不借此宣称已经重跑业务门禁。业务代码与测试断言没有修改。

本次未合并分支、创建 Git 提交、推送、升级生产库或生产切流；真实供应商、模型、临床及托管 CI 的原验收边界不变。他人修改和原运行数据保持原状。
