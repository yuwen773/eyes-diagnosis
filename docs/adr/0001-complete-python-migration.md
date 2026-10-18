---
status: accepted
---

# 完整迁移到 Python，并保留现有数据与 Vue 前端

2026-10-15，用户在 grill-with-docs 第一轮确认 1A、2A、3A：保留 Vue 前端，将后端、算法和 Agent 全部纳入 Python 技术栈，开发、测试、部署及运行均无需 Java/JVM；完整承接现有账号、用户 ID、诊断记录、聊天、知识库和未完成工作流。替代能力验收通过后，从项目主目录移除 Java 源码和构建文件，通过 Git 标签保留历史版本，以得到无 Java 依赖的项目，同时延续现有用户界面和业务数据。

## 对既有约束的影响

- 最终目标取代旧迁移规范中“Java 继续拥有三个会话端点”和“原 Java 源码与构建配置永久保留于项目”的边界；删除操作以替代能力验收通过为前提。
- 原规范 `docs/superpowers/specs/2026-10-12-python-agent-migration-spec.md` 与 `docs/migration-decisions.md` 保留原状，作为前一阶段的决策记录。
- 具体解析工具、Python 迁移库及其版本在实施时通过验证确定，须遵守下列已确认边界。本记录不代表已经迁移、删除源码、创建标签或通过验收；完整设计见 `docs/plans/2026-10-15-complete-python-migration-design.md`，用户已于 2026-10-15 回复“确认”批准整体方案，进入实施拆分。

## 第二轮确认：登录、兼容、切换与验收

2026-10-15，用户确认 4A、5A、6A、7A：

- 切换后允许所有用户重新登录，保留原账号、密码和业务数据，不要求旧 Spring Session 登录态无感延续。
- 本轮以去除 Java 和保持业务兼容为主；旧缺陷单列，确有迁移阻碍的再逐项确认。迁移引入的问题必须修复，不据此授权顺带修改既有业务行为。
- 允许维护窗口：暂停新写入、处理在途任务、备份后切换；具体时长通过演练确定。
- 无 JVM 的工程与真实基础设施验收通过后，可最终移除 Java。真实 embedding、LLM、分类、COS 和临床验证分项记录，未验证或已阻塞项继续如实保留，不能据“去 Java 完成”宣称全部能力通过验收。

这意味着最终去 Java 的工程验收不能继续依赖旧 Java 登录服务、Tika JVM、Flyway/Maven 或读取 Java 源码的契约测试；需在无 JVM 环境证明对应替代能力。工单 19 的旧 Java 大用户 ID 读端阻塞属于前一阶段历史证据，不能改写为通过；其是否适用新阶段由新阶段验收范围明确裁定。

## 第三轮确认：环境、文档工具、旧任务与首次回退

2026-10-15，用户确认 8A、9A、10A、11A：

- 支持 Windows 本地开发、Linux 部署与 CI。
- 允许 Python 调用随部署安装的非 JVM 本地 `.doc` 解析工具；要求固定版本、可验证且无 Java 依赖。具体工具及中文、表格等解析能力尚未验证，不能提前承诺替代完成。
- 现有 Python 未完成任务必须恢复。若存在旧 Java 未完成任务，保留完整记录、明确标注并提供人工处理路径，不要求自动转换 checkpoint 续跑，不得丢弃任务或将其标记为成功来完成迁移。
- 首次切换在维护窗口内、尚未恢复业务写入时，可以回退标签保存的旧版本。最终验收通过后的部署与常规回退均只依赖 Python；本决定不授权在恢复写入后直接回退旧 Java 或恢复旧备份覆盖新数据。

## 第四轮确认：身份实现、数据库承接、旧任务处理与交付

2026-10-15，用户确认 12A、13A、14A、15A：

- 继续使用浏览器 Cookie，由 Python 在 Redis 保存可撤销的登录态；保留现有账号密码、登录接口和权限失效行为，不改为 JWT/token 交互。
- 冻结旧 SQL 和 Flyway 历史；核验数据库并完成必要升级后，建立 Python 迁移链的承接基线，分别验证空库初始化与旧库升级。不长期复刻 Flyway 的历史格式和执行规则，不自动修复历史或结构不一致。
- 旧 Java 任务提供有权限控制的只读记录。用户明确确认后可新建诊断任务并关联旧任务，必要时重新上传；旧审核和保存授权不自动转移，不覆盖旧任务状态与来源。
- Linux 主要采用容器化部署并提供 Compose 编排；Windows 本地开发使用 Python 环境与启动脚本。具体依赖工具必须满足无 JVM 的构建与运行门槛。

## 核查发现与待实现范围

工单发布记录：2026-10-15，用户批准合并后的 8 张拆分并明确要求生成正式本地工单，已发布至 `.scratch/python-project-migration/issues/`，索引见该 feature 的 `README.md`。全部 52 条验收判据保留，实施尚未开始；本地发布不代表任何能力已经验收。

- 旧 Java 未完成工作流不等同于传统已保存诊断记录，也不等同于现有 Python 工作流。当前工作流查询要求 Python UploadInput，复核入口要求当前图版本与 checkpoint 绑定，因此旧任务的查看与人工处理是待补齐能力，不能称为已支持。依据：`algorithm/web/routers/workflow.py`、`algorithm/web/routers/review.py`、`algorithm/web/tests/test_workflow.py`。
- 当前 DOC fixture 只证明英文正文、空内容与非法文件行为；中文、合并/嵌套表格和页眉页脚的既有断言属于 DOCX。替换 DOC 解析器时需单独补充代表性 DOC 样本验证，不能借用 DOCX 结果。依据：`algorithm/web/tests/test_document_upload.py`。
- 数据库共用 V1–V22 历史，包含 bootstrap callback 和非幂等 SQL，既有 V8 checksum 问题另有处理约束。替代工具不得无条件重放旧迁移或自动修复 checksum；需分别验证空库初始化和既有库承接。依据：`deploy/workflow-migrations/README.md`、`docs/flyway-migration-history-plan.md`。
