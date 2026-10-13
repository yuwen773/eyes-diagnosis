# 工单 05 双轴独立审查

日期：2026-10-13。用户确认基点：`60c9d8e4ad062576e35d6f3a02ba2d9d1582013a`。
初审：`git diff 60c9d8e...920f125`；修复复审：`git diff 920f125..8e9a2cd`。
最终收尾还覆盖 `test_foundation.py` 的旧迁移范围断言调整。

按照 implement → code-review 流程，Standards / Spec 由两个独立只读子代理并行审查。
Spec 子代理首次遇到模型容量错误，重试后完整完成初审及修复复审。

## Standards

标准源：worktree `AGENTS.md`、用户给出的 Windows/最小改动/简单设计规则，
主检出 `.agents/skills/vue-best-practices/SKILL.md` 及四份核心 references，
code-review 的 Fowler smell baseline。

初审报告：**0 项发现**。数据库新增列采用小驼峰命名，ORM 显式映射；
Vue 变更沿用现有 Composition API、组件与 composable 边界。
新增附件存储接口承担可替换外部存储边界，有测试需求支撑，不判为 speculative generality。
未将已有 SFC 顺序、既有页面规模或未提交文件作为本轮问题。

修复增量复审：**0 项发现**。COS SDK 接线修正、旧 NULL 子类型兼容、
前端类型同步及对应回归测试均属于原问题的必要修复。

全量回归后的测试清单调整复审：**0 项发现**。新增清单恰好对应工单 05 的
会话、消息、附件归属、执行与审计映射，以及只读旧上传表桥接；仍明确禁止映射
未迁移的 `t_chat_session`、`t_chat_history`。没有扩大迁移边界。

## Spec

规范源：`.scratch/python-agent-migration/issues/05-chat-session-memory.md` 及
`docs/superpowers/specs/2026-10-12-python-agent-migration-spec.md` 的本票相关部分；
与原 Java controller/service、实际前端调用和锁定 SDK 对照。

初审发现 2 项 P1，均已修正：

1. **旧 Java 用户消息被排除出模型上下文。** 初版仅接纳 `sub_type == "text"`，
   原 Java `ChatHistoryService.saveUserMessage` 写的是 SQL NULL。
   违背“历史内容实际进入模型上下文”。先用原始 SQL 插入真实 NULL 行，在真实 MySQL
   的 HTTP 回归复现旧事实丢失，再修正 ORM/前端 nullable 类型及 NULL/text 上下文筛选。
   工具、推理消息仍不进入普通事实记忆。
2. **COS 客户端类名错误。** 初版调用锁定 SDK 不存在的 `COSClient`，
   违背“附件……由 Python 承接”。本地安装的 cos-python-sdk-v5 1.9.44 实际导出
   `CosS3Client`。先增加 HTTP 用例证明真实客户端构造失败，再改用正确类名。
   新回归实际构造 SDK 客户端，仅替换 put_object/delete_object 的远端操作，
   验证上传、未绑定清理及清理后拒绝复用。

Spec 子代理独立复审确认：**原 2 项 P1 均已关闭，修复增量未引入新的 Spec 问题**。
独立执行两项针对性回归：2 passed，13 deselected。
未发现需要提前实现后续工单的缺口或明确范围扩张。

## 最终验证与边界

- Python Web：483 passed，0 skipped；本票 9 个 Python 模块 mypy 通过。
- 前端：25 passed；Vue 类型检查和生产构建通过。
- 真实独立 MySQL 8.0.26：Flyway migrate/validate 至 V17，15 项聊天 HTTP 回归通过。
- Chromium + 原页面 + 实际 HTTP/SSE：7 项通过、无页面脚本错误；包含独立后端进程
  重启、附件恢复、会话隔离、模型失败和停止生成。
- 全量回归首次为 481 passed / 2 failed，失败项是仍要求 Agent 表不迁移的旧范围断言。
  按本票新增映射更新后，24 项 foundation 回归及最终全量均通过。
- Java 身份、模型与 COS 远端操作使用替身。真实 Java V17 启动、DashScope、COS、
  Nginx 切流/回退仍未验证；这些结果不代表完整迁移或真实模型验收通过。

Standards：0 项，最严重项无；Spec：2 项 P1 已关闭，未关闭 0 项。
