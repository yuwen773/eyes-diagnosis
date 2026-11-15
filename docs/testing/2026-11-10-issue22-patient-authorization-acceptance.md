# #22 患者授权保存工程验收

日期：2026-11-10。需求为 [#22](https://github.com/yuwen773/eyes-diagnosis/issues/22)，父规格 [#15](https://github.com/yuwen773/eyes-diagnosis/issues/15)，操作说明见 [patient-authorization.md](../patient-authorization.md)。用户确认患者授权 HTTP API、隔离 MySQL 事务集成测试边界和评审基点 `a28114c8c90cdfc9df4da1cc38b2bec673f36298`。

最终产品及测试变更的暂存树为 `102d0257ada7ef4500c826fb602a56791c89a487`；此后仅增加本验收记录。当前分支 `worktree-java-multi-agent-arch`。原有未跟踪的规划和调研文件未改动、不纳入提交。

## 最终验证

| 检查 | 实际结果 | 证据及范围 |
|---|---|---|
| Corretto JDK 21，CI profile，`mvn -B clean test` | PASS：267 项，0 failures/errors，17 个明确 opt-in skipped | `tmp/issue22/final-backend.log`、`final-reports/`；本轮一次性 MySQL 8.0.36、Redis、Chroma 服务 |
| #22 授权 HTTP + 真库专项 | PASS：35 项，0 skipped | 包含于最终全量；`issue22` 完整例数和零跳过门禁通过 |
| #17–#21 真库回归 | PASS：17 / 13 / 27 / 36 / 37 项，均 0 skipped | 同一最终全量，`backend-unit` 跳过门禁通过 |
| Flyway、上传 Mapper 和应用上下文 | PASS | 迁移至 V14，空库迁移及 Mapper 共 4 项，`contextLoads` 通过 |
| 前端全量 | PASS：8 文件、51 项 | `final-frontend.log`；最终患者页专项 13 项亦通过 |
| 类型检查、生产构建、lint | PASS：0 新 lint 违规 | `final-typecheck.log`、`final-build.log`、`final-lint.log`；保留既有大 chunk 提示 |
| 文档及报告门禁单测 | PASS：32 项 | `python -m unittest discover -s scripts/tests -p 'test_check_*.py'` |
| 设计、steering、概率量纲、YAML、差异检查 | PASS | 三项脚本、工作流 YAML 解析和 `git diff --cached --check` |
| 桌面/移动浏览器交互及截图检查 | PASS：1440×1000、390×844，无 pageerror 或移动横向溢出 | **合成 API 响应**；`browser.json`、`patient-offer-desktop.png`、`patient-restricted-receipt-mobile.png` |

17 个显式跳过为 Chroma 专用集成 1 项、模型 RAG 评估 2 项、协调恢复 PoC 14 项，相应 opt-in 环境变量未设置；没有其他意外跳过或用例减少。HTTP 套件执行真实业务实现、生产 JSON 配置及真实隔离 MySQL，身份、推理和资料均为受控合成夹具。浏览器交互独立于真库 HTTP 验证，不代表浏览器至真实后端的联合验收。

## 验收标准对应证据

1. 医生批准、查看说明或准备授权候选均不创建正式诊断记录。保存必须显式调用批准接口，带回实际查看的授权 ID、任务/草稿/证据版本和内容摘要。其他患者、医生、管理员、资料审核人员及匿名身份不能跨账号批准或读取回执。
2. 批准前重新执行来源资格、文档/治理版本、范围和片段校验，以及任务输入、推理、草稿、证据及协作材料的冻结校验。另验证授权内容摘要、完整患者投影及数据库有效期。来源撤回、内容或版本变化、过期均拒绝保存，并持久化任务与候选受限状态；原医生决定保持不变。
3. 来源、任务及冻结材料锁持续到正式记录、患者授权与唯一回执一同提交。在正式记录插入或授权更新处注入数据库写入失败，验证三者整体回滚；解除故障后原授权可重新提交成功。
4. 8 路并发批准返回相同回执，只产生一条正式记录。相同版本重试和查询回放原回执；后来来源撤回或候选有效期届满不制造新记录，也不重新展示受限内容。来源/任务锁竞争验证等待者读取已提交的新状态，而非旧快照。
5. 授权内容及摘要覆盖完整分层说明、来源和拟保存的模型疾病/原始概率。页面明确展示这些内容及限制；未勾选不能提交，批准请求带回精确版本及摘要。受限任务保留独立的历史回执查询入口，查询后不显示来源或说明。正式历史的 `confidence`/`probability` 与授权概率一致，私有对象键和内部推理不写入患者历史文本。

## TDD 与独立评审

首个 HTTP tracer 在缺少新端点时失败，随后通过，见 `red-initial.log`、`green-initial.log`。补查时刻契约先复现非 ISO 响应及 UTC/本地时区混用导致的过期显示，修复为新接口显式 ISO 字符串与 UTC 解析，回归验证期限仍在未来及回执时刻接近当前时间。

### Standards

最终 **0 项未解决发现**。独立首轮及增量复审均通过；受限回执入口问题转交 Spec 轴处理。

### Spec

最终 **0 项未解决发现**。首轮共 3 项 P2：受限任务回执入口被隐藏、授权预览未明确覆盖模型疾病/概率、历史概率字段映射遗漏。全部修复；新增模型字段与历史概率回归在修复前分别失败，见 `red-review-content.log`；修复后专项 35 项通过，纳入最终全量，见 `green-review.log`、`final-backend.log`。独立增量复审确认全部关闭且无新增偏差。

双轴汇总：Standards 0 项未解决；Spec 0 项未解决。

## 交付范围

增加 V14 迁移、授权 API、患者页显式保存流程、`issue22-mysql` CI 作业和零跳过门禁；本轮仅提交当前本地分支。未推送、合并、关闭工单、部署或运行远端 GitHub Actions。测试未使用业务数据库，一次性验证服务完成后清理；本地证据保留于忽略目录 `tmp/issue22/`。

真实模型/Python、真实医生资格、真实医学资料领域审核、浏览器至真实后端联合、临床和生产验收均未执行。本记录仅证明上述本地工程范围。

## 2026-11-10 证据核验补充

[当前分支交付、实际 CI 例数与验收边界](2026-11-10-multi-agent-closeout-and-parent-acceptance.md#issue22)已集中归档；本节不改写上文历史运行结果。按用户确认，issue 仅补一条短评论，保留原正文和状态。
