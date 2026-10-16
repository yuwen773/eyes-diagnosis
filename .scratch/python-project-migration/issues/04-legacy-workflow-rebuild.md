# 04 — 旧版任务查看与显式关联重建

**What to build:** 提供按归属鉴权的旧任务只读页面，并在用户明确确认及必要重上传后幂等创建新诊断工作流，保持原记录与批准状态独立。

**Blocked by:** 02 — Python 登录鉴权与前端接线。

**Status:** ready-for-human

**内部实施顺序:** 只读查看先完成，再接入确认和关联重建；列表、详情、确认、持久化、Worker 及 UI 作为一个完整用户过程验收。

**Acceptance criteria:**

- [x] 旧任务只读 API/UI 不要求 Python UploadInput 或当前图/checkpoint 绑定，能处理真实旧结构中的缺失字段，不反序列化执行 Java checkpoint。
- [x] 查询以原 owner 归属鉴权，跨用户与匿名访问被拒绝，不因旧版缺字段绕过权限；医生/管理角色如需查看，沿用明确授权语义。
- [x] 清楚区分传统已保存记录、旧版未完成任务和当前 Python 工作流；旧任务保留原状态、时间与来源，不伪装完成或可续跑。
- [x] 列表、详情和刷新行为通过 HTTP/UI 验证；查看不触发任务、模型、复核或正式业务写入。
- [x] UI 展示重建含义并获得明确确认后才创建；用户、原任务、来源时间及审计关系持久保存，原数据/状态不被覆盖。
- [x] 创建在 HTTP/持久化边界幂等，重试不创建重复任务或重复执行；匿名、跨用户及无效旧任务请求被拒绝。
- [x] 旧输入无法可靠复用时要求重新上传；缺失输入、旧结果或 Java checkpoint 均不被当作新任务已完成的依据。
- [x] 新任务走现有 API → Worker 路径，医生复核和保存授权重新执行；旧批准不转移，不自动创建正式诊断记录。

**Verification:** 旧结构数据的 API/UI → 明确确认 → 幂等关联创建 → 独立 Worker；覆盖跨用户、重试、原输入缺失及新批准。

**Spec:** [完整去 Java 的 Python 项目迁移](../spec.md)。

**Acceptance mapping:** Q2、Q5、Q10、Q14。

**Worktree:** `D:/Work/code/eye-diagnosis/.claude/worktrees/py-rewrite`，分支 `worktree-py-rewrite`。

**Verification status:** PASS_WITH_LIMITATIONS — 8/8 验收判据在支持范围内完成；Windows Web 794 通过、29 跳过，前端 49 通过，Linux 相关 15 通过，隔离真实 MySQL 六路重试幂等及原 Vue 浏览器 6 项验证通过。双轴复核剩余 0 项。真实供应商/模型、临床、物理桌面、Linux 全量/部署及生产切流未验收。

## 实施与验收记录（2026-10-16，Asia/Shanghai）

- 实现说明：[旧版任务查看与显式关联重建](../../../docs/legacy-workflow-rebuild.md)。
- 最终汇总：[verification-summary.json](../evidence/issue04/verification-summary.json)。
- 双轴复核：[review.md](../evidence/issue04/review.md)；Standards 的重试交互 P2 已修复并复核，最终两轴均 0 项。
- Windows 首轮 3 项测试进程生命周期失败完整留存，修复隔离测试的关闭等待/端口重绑后，最终全量 794/29 通过；没有修改业务恢复、原数据、原 SQL 或 Java 资产。
- 本次仅实施并提交工单 04，不 push、不启动工单 05–08。ready-for-human 不代表生产、真实模型或临床通过。

## Constraints

- 依赖工单完成后方可实施；ready-for-agent 表示定义就绪，不代表当前无阻塞或验收通过。
- 兼容优先，旧缺陷另列；医生复核、冻结 AI 来源与用户保存授权分别保留。
- 不清理业务数据、原有运行文件或他人修改；原 spec、旧迁移记录与证据保留历史身份。
- 原 Java 活跃资产保留到工单 08 的前置替代能力与切换演练通过；由 08 执行受控移除并重新验收，不由前置工单提前删除。
- 在隔离环境验证，不默认执行真实业务库升级、生产切流、远端发布或推送；受控、真实基础设施、真实模型/供应商及临床结果分开报告。
