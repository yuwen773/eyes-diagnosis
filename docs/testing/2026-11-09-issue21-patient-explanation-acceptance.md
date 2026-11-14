# #21 患者分层解释工程验收

日期：2026-11-09。需求为 [#21](https://github.com/yuwen773/eyes-diagnosis/issues/21)，父规格 [#15](https://github.com/yuwen773/eyes-diagnosis/issues/15)，操作说明见 [patient-explanation.md](../patient-explanation.md)。用户确认患者任务 HTTP API、患者页公开交互的测试边界，以及评审基点 `93c2728b80157b33e125ffbf0302ae2d1f9e0046`。

验证基于当前 `worktree-java-multi-agent-arch` 加本次补丁。评审修复后的实现暂存树为 `5f924714fd74f0fab5548841dc96ebfd1db8264c`；随后仅将原前端测试中的 `any` 改为 `unknown` 以通过 lint，并补验收文档，未再改产品代码。未跟踪的规划及调研文件保持原样，不纳入提交。

## 最终验证

| 检查 | 实际结果 | 证据及范围 |
|---|---|---|
| Corretto JDK 21，CI profile，`mvn -B clean test` | PASS：232 项，0 failures / errors，17 skipped | `tmp/issue21/final-backend.log`、`final-reports/`；本轮创建的一次性 MySQL 8.0.36、Redis、Chroma |
| #21 真库 HTTP 专项 | PASS：37 项，0 skipped | 包含于最终全量；`issue21` 完整例数与零跳过门禁通过 |
| #17 / #18 / #19 / #20 回归 | PASS：17 / 13 / 27 / 36 项，均 0 skipped | 同一全量的报告；`backend-unit` 跳过门禁通过 |
| Flyway 及上传 Mapper | PASS：4 项，0 skipped；迁移到 V13 | 同一全量，未新增或修改迁移 |
| 前端全量 | PASS：8 个文件，51 项 | `tmp/issue21/final-frontend.log`；之后只改测试类型标注，患者页 13 项复验通过 |
| 类型检查、生产构建、lint | PASS，0 新 lint 违规 | `final-build.log`、`final-typecheck.log`、`final-lint.log`；保留既有大 chunk 提示 |
| Python 文档及报告门禁单测 | PASS：32 项 | `python -m unittest discover -s scripts/tests -p 'test_check_*.py'` |
| 设计、steering、概率量纲门禁、工作流 YAML、差异检查 | PASS | `check_design_doc.py`、`check_steering_docs.py`、`check_probability_scale.py`、YAML 解析、`git diff --cached --check` |
| 桌面及移动浏览器 | PASS：1440×1000、390×844，无横向溢出、无 pageerror | **合成 API 替身**；`tmp/issue21/browser.log`、`patient-desktop.png`、`patient-expanded.png`、`patient-mobile.png`、`patient-restricted.png` |

17 个显式跳过为 Chroma 专用集成 1 项、RAG 模型评估 2 项、协调恢复 PoC 专用 MySQL 14 项，相应 opt-in 环境变量未设置；没有其他意外跳过或用例减少。最终 `contextLoads` 通过。HTTP 使用真实业务实现、真实 MySQL 和生产 JSON 配置，身份来自受控替身；全部图片、推理、文本和资料为合成夹具。

## 验收标准对应证据

1. 进度区分排队、图像分析、等待或执行协作、真正等待医生、结果可读和受限。工作摘要只读取 Agent 角色及业务状态，并映射成后端固定文案，不读取其输出作为进度文本。
2. 每次结果及引用读取都复验任务归属、医生批准、任务版本、输入、推理、草稿、冻结证据及协作材料。批准后的任务版本必须恰为冻结版本加一；来源持锁复验与撤回串行化。六个区段及精确引用使用与草稿生成相同的确定性校验。
3. 质量失败、模型拒识和证据不足仅返回固定提示。未批准或不通过时无结果及引用；未知状态默认受限。来源失效或材料变化使任务持久化为受限，不改写原医生决定、意见及时间，也不生成替代材料。
4. 本人任务的获准结果显示主要信息、风险、下一步及醒目的“模型预测并非确诊”；依据、不确定性和限制默认折叠。来源文本不作为 HTML 或可执行链接。刷新、切换任务或账号、失败及迟到响应不会恢复旧结果。
5. HTTP 验证其他患者、医生、管理员、资料审核人员及未登录身份不能跨账号读取任务或引用。覆盖来源撤回/治理与文档变化/禁用/测试标记/范围和片段变化，材料及推理变更，以及来源锁、任务锁竞争。
6. 既有任务列表及状态继续只提供安全投影；普通诊断和聊天未接入新读取流程。既有后端、前端相关套件通过。没有自动保存正式记录或增加追问接口。

## Standards

最终 **0 项未解决发现**。首轮 P3：新结果面板缺少 DESIGN.md 的容器圆角，已补 `var(--iris-radius)`。同时采纳重复解析的简化建议，由读取门禁直接携带校验后的类型化草稿。独立增量复审 PASS。

## Spec

最终 **0 项未解决发现**。首轮 P2：图像推理已完成但草稿运行尚不存在时，过早显示等待医生。新增 HTTP 回归先复现 `expected PROCESSING / actual WAITING_REVIEW`（`tmp/issue21/red-review-stage.log`），修复为根据草稿运行状态区分协作和医生复核；纳入最终 37 项专项及 232 项全量，独立增量复审 PASS。

双轴汇总：Standards 0 项未解决；Spec 0 项未解决。

## 交付范围

新增 `issue21-mysql` CI 作业及零跳过门禁；本轮仅提交当前本地分支，未推送、合并、关闭工单或部署，也未运行远端 GitHub Actions。没有使用本机业务库。临时验证服务由本轮创建并在验证后清理。

浏览器检查不属于浏览器到真实后端的联合验收。真实模型/Python、真实医生资格、真实资料领域审核、临床和生产验收均未执行；本记录只证明上述本地工程行为。
