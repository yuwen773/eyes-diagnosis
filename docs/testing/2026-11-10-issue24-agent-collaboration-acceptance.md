# #24 四 Agent 协作评估工程记录

日期：2026-11-10。需求：[工单 #24](https://github.com/yuwen773/eyes-diagnosis/issues/24)。用户授权 implement、当前分支提交，并确认离线评估 CLI、真实协调器公开入口与患者 HTTP 测试边界；使用合成数据、模型替身及隔离测试库。评审基点 `7e3410792bc431fb74dc40a35cffdba289588eb0`。

## 产物与范围

- [重跑方法和指标定义](../../evaluation/agent-collaboration/README.md)、[固定语料](../../evaluation/agent-collaboration/corpus.json)、[CLI](../../scripts/evaluate_agent_collaboration.py)。
- [本轮可读报告](issue24-2026-11-10/report.md)、[逐样例结果与阶段轨迹](issue24-2026-11-10/results.json)。报告保留源提交、语料及评估器 SHA-256、原始可靠性 XML 哈希。Git 源提交指生成时评估代码和产品代码；之后仅归档证据。
- CI 新增 `issue24-evaluation`：执行 CLI 测试、#19/#21 真实 MySQL 专项及零跳过门禁，再执行消融、导入结果并上传报告和 XML。本轮未推送或运行远端 CI。

固定八例包含四个可生成样例与四个应受限样例。单 Agent、四 Agent 及四个逐角色消融条件各运行八例，共 48 单元。使用同一套输入、角色响应脚本、来源资格和独立评分标注；实际执行阶段、上下文与输出全部保留。gold 不进入角色上下文。候选声明引用正确性、无依据声明、遗漏、就绪召回、错误就绪均报告分子与分母，避免把零输出当作高质量。

这是测试专用参考流程中的脚本替身评估，差异来自有意植入的行为，不能证明真实四 Agent 更优，也不作为产品协调器的消融实验。真实模型生成质量、耗时、token 与费用为 **NOT_RUN**；本地替身流程及评分耗时分别实测，提供方调用和费用为 0。真实产品协调器可靠性单独列示，不与替身对照混成一个效果结论。

## 验证

| 检查 | 结果与边界 |
|---|---|
| CLI 专项 | 12 项通过；覆盖配对矩阵完整性、真实阶段移除、评分分母、无输出、重复声明、逐引文支持、gold 隔离和可靠性报告失败/跳过 |
| scripts Python 全套 | 48 项通过；MySQL 健康探针使用本轮隔离容器 |
| 协调器和患者 HTTP 专项 | 64/64，0 failures/errors/skipped；27 项草稿 + 37 项患者解释；真实隔离 MySQL、合成身份/资料/模型 |
| 前端完整回归 | 8 文件、60 项通过；类型检查通过。未改前端 |
| 最终后端完整回归 | 304 项，0 failures/errors，17 项明确 opt-in skipped，287 项实际通过；CI profile、JDK 21，报告门禁通过 |
| 静态与文档检查 | Python 编译、设计/steering/概率量纲门禁、工作流 YAML 解析和差异检查通过 |

可靠性组包括证据不足、工具越权、独立 JVM 崩溃恢复、质量/拒识/证据受限、患者身份越权、迟到输出、来源撤回。分母是测试案例数，不是患者数。报告逐例保留 PASS / FAILURE / ERROR / SKIPPED；缺失报告或必要行为不接受为通过。

最终全量回归日志为 `tmp/issue24/final-backend.log`，原始 XML 归档为 `tmp/issue24/final-reports/`。最终报告导入此轮 #19/#21 XML，两个专项零跳过门禁均通过。17 项跳过为 Chroma 集成 1 项、RAG 模型评估 2 项、协调 PoC 14 项，相关 opt-in 变量未设置。最终全量结果没有替代下述首轮失败记录；既有租约测试本轮原样通过，首次失败的根因仍未确定。

## 全量回归首轮失败

首轮 `mvn -B clean test`：304 项，1 failure、2 errors、17 skipped，结果为 **FAIL**。原始日志为本地忽略产物 `tmp/issue24/first-full-backend.log`，XML 为 `tmp/issue24/first-full-reports/`。

- 既有 #17 `resultCannotCommitAfterLeaseExpiresWhileWaitingForRowLock` 预期 PROCESSING，实际 WAITING_REVIEW。本轮不修改该测试或产品实现，也不据单次失败断言根因。
- #22 两个写入失败回滚测试创建合成触发器时，隔离 MySQL 开启 binary logging，测试账号缺少所需权限，错误 1419。只在本轮新建的一次性容器中设置 `log_bin_trust_function_creators=1`，随后原样复跑。没有修改业务库、原有服务或仓库门禁。
- 首次运行全部脚本测试缺少 `ISSUE17_MYSQL_CONTAINER` 环境变量，在健康探针初始化处报错；指定本轮测试容器后，48 项完整通过。该初始化错误不记作通过。

## Standards

独立评审相对固定基点的实现：0 项发现；独立 CLI 12 项通过。随后根据换行规范，将生成的 JSON/Markdown 明确固定为 LF，CLI 12 项再次通过。

## Spec

独立评审核对实现、48 个结果单元、64 项可靠性分母和初版 XML 哈希：0 项未解决缺陷。语料说明中错误提及固定样例含错误引文的问题已修正；错误引文实际由 CLI 变异测试覆盖。最终报告已改用最终完整回归 XML 重新生成，并更新语料 SHA-256。两轴各 0 项未解决发现。

## 证据分层与交付

离线脚本替身、真实 Java/MySQL/HTTP 工程验证已运行。真实模型服务、真实 Python 推理、浏览器、真实医学资料领域审核、临床和生产验收均 **NOT_RUN**。本轮无临床有效性或生产验收结论。

原有未跟踪规划与研究文件保持原样。本轮只向当前本地 `worktree-java-multi-agent-arch` 分支提交，不推送、合并、关闭工单或部署。

## 2026-11-10 证据核验补充

[当前分支交付、实际 CI 例数与验收边界](2026-11-10-multi-agent-closeout-and-parent-acceptance.md#issue24)已集中归档；本节不改写上文历史运行结果。按用户确认，issue 仅补一条短评论，保留原正文和状态。
