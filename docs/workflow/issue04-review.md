# 工单 04 双轴审查

日期：2026-10-13。用户确认基点：`57e9db7d8f799ce6653758a53392aed2fc8ec9be`。
实现提交：`3d2078828a6cec076ff1e43b9e4644fc98503356`。
初次范围：`git diff 57e9db7d8f799ce6653758a53392aed2fc8ec9be...3d2078828a6cec076ff1e43b9e4644fc98503356`；
收尾复核还覆盖同一工作区随后提交的修正。

已按 `code-review` 技能并行启动 Standards / Spec 子代理。标准轴返回 CSS
发现后因用量限制中断，规格轴未形成完整报告；用户继续后重试均返回模型容量错误。
因此下列为主代理分别完成的两轴核对与修正记录，不能宣称取得两份独立最终审查。

## Standards

标准源：工作区 `AGENTS.md`、用户提供的 Windows/最小范围/目标验证规则，以及
主检出 `.agents/skills/vue-best-practices/SKILL.md` 和 `references/sfc.md`。
数据库字段使用小驼峰、Vue Composition API/TypeScript、薄路由页和组件职责拆分
均符合本票规则；Java 源码、根构建、旧迁移与源 spec 未改动。

- **[P3，已修复] scoped CSS 标签选择器。** 初始 `QualityReviewDetail.vue`、
  `QualityReviewPanel.vue`、`ReviewTaskList.vue` 使用 `h2`、`button` 等裸标签，
  不符合 `references/sfc.md` 的 “Use class selectors in scoped CSS”。已为对应
  元素添加类并改为类选择器，保持布局和动作不变。

未留下其他确定的标准违规；没有为一般代码气味判断新增抽象或改动邻近旧代码。

## Spec

规范源：`.scratch/python-agent-migration/issues/04-quality-review.md`、
`docs/superpowers/specs/2026-10-12-python-agent-migration-spec.md` 的工单相关
AC-11/12/21 与业务不变量、release `5ac742f` 的 ADR-004 和质量复核决定矩阵。

- **[P2，已修复] 详情/图片授权可能读取过期领取人。** 工单要求“权限、领取人和
  任务/工作流版本均在服务端校验，禁止自审、越权和过期提交”。初始 GET
  `load_task()` 先读取任务，等待工作流锁后没有刷新任务；在 MySQL REPEATABLE READ
  下，期间领取成功的任务可能仍按较早 OPEN 快照授权。现在所有调用均在
  工作流锁后对任务使用 current locking read 与 `populate_existing`，再检查领取人。
  现有 HTTP 权限回归通过，真实 MySQL 并发复现尚未进行，未据此标记真实验收通过。
- **[P2，已修复] 旧任务操作响应覆盖当前复核页面。** 规范要求“断流后的界面通过
  服务端状态恢复，不把本地缓存当成已完成或已保存的依据”。初始 `act()` 仅检查
  disposed；领取请求仍在执行时切换任务，迟到的冲突会清掉新详情。
  已先加入页面测试复现失败，再用现有 generation 检查丢弃旧操作的成功/失败响应。
  新用例与所有前端回归通过。

核对结果：只允许质量继续/重传，服务端校验版本与领取人并禁止自审；图恢复
`qualityReview` 后保留原包与原 OOD/拒绝事实；重复提交不新增恢复 Job 或医生事件；
待复核任务及已提交决定可跨应用重建和独立 Worker 进程恢复；患者看到医生结果，
仍不暴露原始预测或自动保存正式记录。未发现额外功能扩张或未关闭的确定功能问题。

## 验证与限制

- Python Web：468 passed，含 20 项质量复核 HTTP 测试；mypy 12 个源文件通过。
- 前端：22 passed；Vue 类型检查与生产构建通过。
- Chromium：实际本地 HTTP/Vue/FastAPI/Worker 验证领取、两种决定、患者展示、
  刷新、版本冲突与访问控制；SQLite/Java/算法替身，无页面脚本错误。
- V16 真实 MySQL 升级与并发、真实 Java 医生身份、真实模型和生产部署未验证。
- 质量批准后的解释能力仍按后续工单交付，当前明确报告
  `EXPLANATION_NOT_AVAILABLE`；旧 v2 任务不会静默采用新 v3 图。

Standards：1 项已修复，未关闭 0 项；Spec：2 项已修复，未关闭 0 项。
独立子代理最终审查未完成，完整业务与真实服务验收仍按后续工单执行。
