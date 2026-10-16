# 03 — 非 JVM 文档解析与知识库闭环

**What to build:** 先用真实 DOC 样本选择并验证非 JVM 工具，再接入已登录用户的上传、分块、索引和检索路径，保持旧知识库数据与权限约定。

**Blocked by:** 02 — Python 登录鉴权与前端接线。

**Status:** ready-for-human

**内部实施顺序:** 工具选型是本票内部的先行验证关卡；样本不通过时不接入正式上传，也不再另开选型工单。

**Acceptance criteria:**

- [x] 从可核验来源选择工具并固定版本/产物校验依据，验证两环境安装与执行不依赖 JVM；记录许可证和分发方式作为交付依据。
- [x] 使用真实二进制 DOC 样本分别验证中文正文、表格、页眉页脚与编码，明确提取内容判据；不把现有 DOCX 结果当作 DOC 证据。
- [x] 最小适配入口对空内容、损坏、加密与伪装文件给出明确结果，具备进程超时/边界和临时资源清理，请求时不下载工具。
- [x] 记录样本结果及能力限制；必要样本失败时保留阻塞，不以丢弃内容或引入 JVM 兜底。工具选型验证阶段不提前切换正式上传路径，通过后再接入本票的上传闭环。
- [x] 正式 DOC 上传路径使用经验证的解析器，Tika 执行/下载不再是该路径依赖；部署固定工具，上传请求不下载依赖。
- [x] DOC 的代表性样本与非法输入走完整上传边界；DOCX 的合并/嵌套表格和页眉页脚能力不退化，失败不得静默生成空索引。
- [x] 真实 Chroma 验证分块、metadata 类型、用户范围和引用；保留 collection、chunk ID、embedding 模型/维度及旧文档，不清空集合或自动重嵌入。
- [x] Windows/Linux 上传解析行为通过；受控 embedding 与真实语义检索证据分别报告，真实 embedding 既有阻塞保留。

**Verification:** Windows/Linux 真实二进制样本与工具边界 + HTTP 上传 → 工具 → 真实 Chroma → 检索/越权拒绝；DOC/DOCX 结果分开。

**Spec:** [完整去 Java 的 Python 项目迁移](../spec.md)。

**Acceptance mapping:** Q5、Q7、Q8、Q9。

**Worktree:** `D:/Work/code/eye-diagnosis/.claude/worktrees/py-rewrite`，分支 `worktree-py-rewrite`。

**Verification status:** PASS_WITH_LIMITATIONS（工单 03 支持范围，2026-10-16）— Windows 最终完整 Web 787 passed / 28 skipped / 1 warning；Linux 最终相关回归 104 passed / 1 skipped；前端构建与 47 项回归、6 个模块 mypy 通过。双环境工具关卡各 5 PASS；真实 Windows MySQL/Redis/Chroma 闭环通过，embedding 与 COS 为受控边界。8/8 判据按上述支持范围完成，待人工复核。

Linux 全量仍为 781 passed / 5 failed / 28 skipped，不记为 PASS；后续工程票须复核其模型、HTTPS MCP、工作流及 Snowflake 时钟回退问题。真实 embedding 历史 HTTP 401 阻塞保留、未重跑；真实 COS、模型/供应商、临床、Linux 完整部署、托管 CI、生产升级/切流与 Java 移除未验收。本票未重跑浏览器实操，不以构建和前端回归替代浏览器证据。

Standards / Spec 两轴复核各 0 findings（交接已完成的复核，收尾未改实现）。最终代码与样本摘要已核对；Java `src/` 与 `pom.xml` 零修改。首轮失败和修复日志保留，不将早期失败改称通过。

[交付及验证记录](../../../docs/no-jvm-document-knowledge.md)；[机器汇总](../evidence/issue03/verification-summary.json)；[双轴复核](../evidence/issue03/review.md)；[证据索引](../evidence/issue03/README.md)。

## Constraints

- 依赖工单完成后方可实施；ready-for-agent 表示定义就绪，不代表当前无阻塞或验收通过。
- 兼容优先，旧缺陷另列；医生复核、冻结 AI 来源与用户保存授权分别保留。
- 不清理业务数据、原有运行文件或他人修改；原 spec、旧迁移记录与证据保留历史身份。
- 原 Java 活跃资产保留到工单 08 的前置替代能力与切换演练通过；由 08 执行受控移除并重新验收，不由前置工单提前删除。
- 在隔离环境验证，不默认执行真实业务库升级、生产切流、远端发布或推送；受控、真实基础设施、真实模型/供应商及临床结果分开报告。
