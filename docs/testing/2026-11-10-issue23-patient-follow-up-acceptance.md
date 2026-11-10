# #23 患者安全追问工程验收

日期：2026-11-10。需求为 [#23](https://github.com/yuwen773/eyes-diagnosis/issues/23)，父规格 [#15](https://github.com/yuwen773/eyes-diagnosis/issues/15)，操作与接口说明见 [patient-follow-up.md](../patient-follow-up.md)。用户确认患者公开 HTTP API、患者页面交互、隔离 MySQL、合成数据和受控身份，以及评审基点 `0c6bd1964f4e51b3c03d706fb71b4ba1ac36c529`。

产品、测试及 CI 变更提交为 `eab2d7f4014a41daea98903a1038720fe34b9fbb`；其后仅增加本验收记录。当前分支 `worktree-java-multi-agent-arch`。原有未跟踪规划和调研文件未改动、不纳入提交。

## 验收标准与实现

1. 每次追问使用登录身份验证本人任务，复用 #21 的医生批准、任务输入绑定、冻结快照与全部材料校验，持有精确来源及任务行锁后查找相关内容。回答仅包含已发布患者声明及其引用的有效冻结来源，不返回未匹配声明或额外来源。获准读取即沿用 #21 的结果发布条件。
2. 使用既有中英文分词器查找已发布原文，不进行模型生成，不使用私人知识库或聊天记忆。无匹配时返回 `INSUFFICIENT_EVIDENCE`，明确未找到合格依据。相关内容以原文和原引用展示，并说明匹配不表示整个问题已获回答。一般眼健康咨询有清晰区分的 `/agent` 入口，不自动传递本次内容或问题。
3. 追问门禁使用只读调用方式；成功、无依据、来源失效及材料变化均不改写任务状态、版本、推理快照、草稿、医生决定、授权候选、正式记录或回执。HTTP 测试覆盖无授权、候选授权及已保存授权，并比较冻结与授权完整状态，保存后的回执仍可原样查询。
4. 未发布、拒绝、受限、来源撤回、资格/范围/版本/片段变化和越权请求不能返回声明或来源。来源撤回竞争验证等待行锁的请求读取已提交的新资格。页面以纯文本显示引用，切换账号、任务或刷新后丢弃迟到响应；受限、网络失败、任务不符和未知状态关闭旧内容。

## 验证证据

最终后端完整回归使用 Corretto JDK 21、CI profile、本轮隔离 MySQL 8.0.36 / Redis / Chroma 服务。产品代码与独立评审提交一致。

| 检查 | 实际结果 | 证据及范围 |
|---|---|---|
| 后端第二轮完整回归 | PASS：304 项，0 failures/errors，17 个显式 opt-in skipped，即 287 项实际通过 | `final-backend.log`、`final-reports/`；`backend-unit` 门禁通过 |
| #23 公开 HTTP + 真实隔离 MySQL | PASS：37 项，0 skipped | 纳入最终完整回归；`issue23` 完整例数与零跳过门禁通过；合成推理、身份及资料 |
| #17–#22 真库回归、Flyway 与上传 Mapper | PASS，0 skipped | 各工单 17 / 13 / 27 / 36 / 37 / 35 项；迁移及 Mapper 共 4 项，`contextLoads` 通过 |
| 前端全量 | PASS：8 文件、60 项 | `final-frontend.log`；患者页专项 22 项 |
| 类型检查、生产构建、lint | PASS：0 新 lint 违规 | `typecheck.log`、`final-build.log`、`final-lint.log`；保留既有 chunk 大小提示 |
| 报告门禁单测 | PASS：33 项 | `python -m unittest discover -s scripts/tests -p 'test_check_*.py'` |
| 设计、steering、概率量纲、工作流 YAML、差异检查 | PASS | 三项既有脚本、YAML 解析及 `git diff --check` |
| 桌面/移动浏览器交互与截图 | PASS：1440×1000、390×844，无 pageerror 或横向溢出 | `browser.json`、`follow-up-1440.png`、`follow-up-390.png`、`restricted-*.png`；**合成 API 响应** |

17 项明确跳过为 Chroma 专项集成 1 项、模型 RAG 评估 2 项、协调恢复 PoC 14 项；对应 opt-in 环境变量未设置。没有其他意外跳过或用例减少。

本地原始证据位于忽略目录 `tmp/issue23/`。浏览器验证与真实 MySQL HTTP 测试是独立证据，不表示浏览器至真实后端联合验收。新增 `issue23-mysql` CI 作业及 37 项完整例数、零跳过门禁；本轮未运行远端 GitHub Actions。

## TDD

首个 HTTP tracer 在缺少追问端点时失败，随后通过：`red-initial.log`、`green-initial.log`。页面首个公开交互同样先复现缺少输入入口，再通过：`red-frontend.log`、`green-frontend.log`。精确来源片段匹配测试先得到无依据响应，修复为在获准片段中查找后通过：`red-excerpt.log`、`green-targeted.log`。后续增加中文及引用范围用例，纳入完整回归。

## Standards

独立评审 `0c6bd19...eab2d7f`：**PASS，0 项发现**。审查了仓库规则、领域术语、设计令牌及固定 smell baseline；机械检查由主代理实际执行。

## Spec

独立评审同一差异：**PASS，0 项发现**。确认范围、来源有效性、无依据提示、独立一般咨询入口、原记录不可变及受限路径。两轴总计各 0 项未解决发现。

## 环境限制与首轮失败

首轮 `mvn -B clean test` 执行 304 项，1 failure、0 errors、17 个明确 opt-in skipped。唯一失败是既有 #17 `resultCannotCommitAfterLeaseExpiresWhileWaitingForRowLock`：预期 `PROCESSING`，实际 `WAITING_REVIEW`。该次完整回归不能记为通过。

单独原样重跑该测试通过；临时增加数据库时刻探针、重复 8 次时再次出现 1 次失败。探针记录显示同一顺序执行中的数据库时刻先后从 `02:48:31.674074` 回到 `02:48:28.213195`，并从 `02:48:36.674798` 回到 `02:48:33.839646`。失败轮宿主机已等待 1607ms，数据库时刻为 `02:48:33.839646`，租约截止为 `02:48:38.338891`，数据库明确返回 `expired=false`。这证明该环境中的宿主机固定等待未保证数据库租约过期，符合该失败症状；不将其归因于 #23 改动。

诊断证据为 `lease-repro.log`、`lease-probe.log`。临时探针及重复注解已完全恢复，未改动 #17 的产品代码或测试断言，未修改数据库/宿主机时钟或系统配置。随后在相同产品代码上原样重新执行完整回归，304 项、0 failures/errors、17 个显式跳过，构建及报告门禁通过。该结果不抹除上述首次失败，也不表示虚拟化环境的时钟风险已修复。

## 交付范围

本轮仅向当前本地分支提交。本轮创建的三个一次性验证容器和 Vite 服务已清理，原有服务保留。未推送、合并、关闭工单或部署。真实模型/Python、真实医生资格、真实医学资料领域审核、浏览器至真实后端联合、临床及生产验收均未执行。
