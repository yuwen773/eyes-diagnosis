# #20 医生复核工程验收

日期：2026-11-09。需求为 [#20](https://github.com/yuwen773/eyes-diagnosis/issues/20)，操作说明见 [doctor-review.md](../doctor-review.md)。用户确认了医生 HTTP API、页面公开交互、患者状态 API 的测试边界，以及管理员明确分配任务的授权方式。

验证基于 `worktree-java-multi-agent-arch` 的 `482d5f6af67cc560f427083b9441f222793179b0` 加本次补丁。最终代码暂存树（附本验收记录前）为 `c5ca523448e21c86c26cdc46cabc365c080f8bcc`；最终全量在评审修复后执行，之后只补验收文档。未跟踪的规划与研究资料保持原样，不纳入交付。

## 最终验证

| 检查 | 实际结果 | 证据及范围 |
|---|---|---|
| Corretto JDK 21，CI profile，`mvn -B clean test` | PASS：195 项，0 failures / errors，17 skipped | `tmp/issue20/final-backend.log`、`tmp/issue20/final-reports/`；使用本次创建的一次性 MySQL 8.0.36、Redis、Chroma |
| #20 真库 HTTP 专项 | PASS：36 项，0 skipped | 包含在上述最终全量；`issue20` 零跳过门禁通过 |
| #17 / #18 / #19 回归 | PASS：17 / 13 / 27 项，均 0 skipped | 同一最终全量中的报告，`backend-unit` 报告门禁通过 |
| Flyway 空库及上传 Mapper | PASS：4 项，0 skipped；迁移到 V13 | 包含在上述全量；`flyway` 门禁通过；空库使用独立随机 schema 并清理 |
| 前端全量 | PASS：8 个文件，42 项 | `tmp/issue20/final-frontend.log`；其中医生页面 7 项 |
| 类型检查、生产构建与 lint | PASS，0 新 lint 违规 | `tmp/issue20/final-build.log`、`final-lint.log`；保留既有大 chunk 提示 |
| Python 报告及文档门禁单测 | PASS：32 项 | `python -m unittest discover -s scripts/tests -p 'test_check_*.py'`；包含 #20 报告缺失、跳过和减少用例的拒绝路径 |
| 设计、steering、概率量纲门禁、工作流 YAML、暂存差异检查 | PASS | `check_design_doc.py`、`check_steering_docs.py`、`check_probability_scale.py`、YAML 解析、`git diff --cached --check` |
| 浏览器页面验证 | PASS：桌面 1440×1000、移动 390×844，无横向溢出、无 pageerror；显示材料并提交冻结版本 | **合成 API 替身**，不属于浏览器到真实后端的联合验收；截图 `tmp/issue20/doctor-desktop.png`、`doctor-mobile.png`，日志 `browser.log` |

17 个显式跳过为 Chroma 专用集成 1 项、RAG 模型评估 2 项、协调恢复 PoC 专用 MySQL 14 项；相应 opt-in 环境变量未设置，报告门禁确认没有其他跳过或用例减少。`contextLoads` 在最终 CI profile 全量中通过。

全部身份、推理、文本和资料均为合成夹具。HTTP 使用真实业务实现、真实 MySQL 和项目生产 JSON 配置，身份从受控替身提供；没有调用真实模型或 Python 推理。日志、XML、截图和浏览器依赖均为被忽略的本地产物。

## 关键业务证据

- 普通患者、管理员、资料领域审核人员、其他医生与被降级账号不能读取或提交医生材料；患者本人不能获分配。已有分配不能被另一医生覆盖。
- 任务、推理、输入版本、草稿、冻结引用与 Agent 异议变化均阻断批准；来源撤回、治理/文档版本变化、禁用、删除、测试标记和片段变化会持久化失效状态，再返回冲突。
- 正反决定同时提交只有一个成功；完全相同的重试回放原医生、意见、时间及材料；后来的来源撤回不会改写历史决定。后续发布/保存仍须独立复验来源。
- 撤回事务持来源锁时批准请求等待，撤回提交后批准失败。任务变更事务持任务锁时，等待的批准请求必须读取变更后的版本并失败。
- 不通过保留医生原因；医生不可用持续等待。患者列表/详情只提供任务 ID 与安全状态，批准不发布草稿，不通过显示受限状态。
- 页面在冲突后关闭旧材料、要求重新打开；切换账号丢弃迟到响应，决定提交需意见和显式核对。

## Standards

最终 **0 项未解决发现**。首轮 P3：主/次按钮缺少 DESIGN.md 要求的 hover，已补齐并通过独立增量复审。浏览器发现增加医生导航后共享菜单在移动端溢出，仅补两条 flex 收缩规则，截图和增量规范评审均通过。

## Spec

最终 **0 项未解决发现**。首轮 P1：MySQL REPEATABLE READ 中提交先普通读取、后等待任务锁，可能沿用旧快照批准。公开 HTTP 回归在真实事务竞争下复现 `expected 409 / actual 200`（`tmp/issue20/red-task-lock.log`）。修复为先锁任务，冻结材料全部使用当前锁定读；单例转绿（`green-task-lock.log`），并纳入最终 36 项专项和 195 项全量。独立增量复审确认修复。

双轴汇总：Standards 0 项未解决；Spec 0 项未解决。

## 交付范围

已新增 `issue20-mysql` CI 作业和零跳过门禁；本轮仅提交当前本地分支，未运行远端 GitHub Actions、未推送或合并。没有使用本机既有业务库，也未部署。一次性验证服务用后删除。

真实医生资格、真实资料领域审核、真实模型/Python、浏览器与真实后端联合、临床和生产验收均未执行；本记录只证明上述本地工程行为。
