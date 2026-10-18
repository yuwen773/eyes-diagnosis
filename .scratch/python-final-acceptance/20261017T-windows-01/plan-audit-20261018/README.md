# 2026-10-18 验收计划再核对

自动子项核对：PASS；当前未发现可独立继续执行的遗漏自动项。
人工验收：DEFERRED；整体验收仍 BLOCKED，第 21 票不关闭。

本次新增：四类合成等待的浏览器刷新、已登记 COS 图片的浏览器 img 加载、原 API 的三次真实普通聊天及跨重启/会话隔离、真实分类任务执行中 API/Worker 重启与 SSE 恢复、原患者/医生页面只读刷新，以及新前端 49 项/类型检查/构建。

没有修改应用实现或安全规则。初次探针的字段名/终态名检查、隐藏 option 文本、医生内部任务 ID 定位错误均保留，只修正验收脚本；真实聊天组件在原 attempt 中已通过，后续只读 UI 复验没有重发模型请求。COS 顶层导航因 attachment 响应转为下载，应用使用的 img 元素加载已通过；没有改桶权限或响应头。

原实际任务 8 张业务表摘要不变；原数据中的 2 条医生提交、0 条正式记录保留。两个新聊天会话仅含随机非医疗记号；执行中重启另用新隔离库和已授权的 1_left.jpg，本机推理、不外发图片。受控浏览器中的模拟决定不计为实际人工验收。

累计 LLM 23/50、embedding 43/500；本次新增 LLM 3 次，失败也计数，不重置预算。

## 逐条计划

| 项目 | 自动子项 | 本项整体 | 剩余依赖 |
|---|---|---|---|
| 2.1 COS SDK 接线修复与公开上传回归 | PASS | PASS | 无 |
| 2.2 原 API/Worker、独立服务、持久清单与身份核对清理 | PASS | PASS | 无 |
| 2.3 真实供应商预检及浏览器读取已登记 COS 探针 | PASS | PASS | 无 |
| 2.4 权重、未校准状态与五图不匹配保留；三张补充样本已本机推理 | PASS | BLOCKED | 补充样本去标识及外发范围尚未确认 |
| 3.1 当前源码快照、依赖/版本与既有证据差异已绑定；不称干净机器验收 | PASS | PASS | 无 |
| 3.2.1 真实 Python Cookie/Redis 登录隔离及原接口回归 | PASS | PASS | 无 |
| 3.2.2 真实 DOC/DOCX 的 COS/embedding/Chroma 与三份已审核参考资料检索解释；分层记录 | PASS | PASS | 无 |
| 3.2.3 真实原图进入生产图；自动部分到质量等待，既有两项合法受限终态保留 | PASS | BLOCKED | 质量/最终复核后的完整真实解释发布和保存需人工继续；禁止代批 |
| 3.2.4 真实同键/聊天绑定与原推理来源；重复保存等用受控回归 | PASS | PASS | 无 |
| 3.2.5 执行中真实模型恢复、真实现有等待恢复、四类合成等待恢复 | PASS | PASS | 无 |
| 3.2.6 真实 SSE 断连/重连、真实患者与医生只读 F5、四类合成等待浏览器刷新 | PASS | PASS | 无 |
| 3.3 实际参与者 UI 验收继续搁置，旧两份质量决定与 F5 确认保留 | PASS | BLOCKED | 患者/医生操作、补充说明、自然最终复核、独立拒绝/批准保存及继续 |
| 3.4 受控罕见分支及 Windows 原 43 项环境门禁；前端重新构建与 49 项 | PASS | PASS | 无 |
| 4 预算共享累计、过程失败保留、数据保留与临时进程清理 | PASS | PASS | 无 |
| 5 计划/22 个 AC 自动子项已逐条归档；不提前关闭第 21 票 | PASS | BLOCKED | 正式验收依赖 3.3 和外发范围确认 |

## AC 分层核对

按已确认计划区分技术检查与真人实操：18 项在当前 Python/Windows 边界内有技术通过证据；AC-08/09/11/21 保留实际参与者阻塞。22 项均有自动子项记录，不将受控决定或自动浏览器计为真人验收。

| AC | 自动子项 | 当前判据 | 受控 HTTP/Worker 回归来源 | 剩余依赖/限制 |
|---|---|---|---|---|
| AC-01 | PASS | PASS | test_chat_workflow, test_workflow | 本项技术检查已完成；实际操作者的完整链路由 AC-08/09/11/21 保留，不据此宣称临床或生产通过 |
| AC-02 | PASS | PASS | test_session, test_contracts, test_tool_writes | 本项技术检查已完成；实际操作者的完整链路由 AC-08/09/11/21 保留，不据此宣称临床或生产通过 |
| AC-03 | PASS | PASS | test_chat, test_history_retrieval | 本项技术检查已完成；实际操作者的完整链路由 AC-08/09/11/21 保留，不据此宣称临床或生产通过 |
| AC-04 | PASS | PASS | test_workflow_inference, test_quality_review | 本项技术检查已完成；实际操作者的完整链路由 AC-08/09/11/21 保留，不据此宣称临床或生产通过 |
| AC-05 | PASS | PASS | test_inference, test_worker_explanation_failure | 本项技术检查已完成；实际操作者的完整链路由 AC-08/09/11/21 保留，不据此宣称临床或生产通过 |
| AC-06 | PASS | PASS | test_controlled_evidence | 本项技术检查已完成；实际操作者的完整链路由 AC-08/09/11/21 保留，不据此宣称临床或生产通过 |
| AC-07 | PASS | PASS | test_validated_explanation, test_worker_explanation_failure | 本项技术检查已完成；实际操作者的完整链路由 AC-08/09/11/21 保留，不据此宣称临床或生产通过 |
| AC-08 | PASS | BLOCKED | test_supplement | 实际参与者补充说明与继续 |
| AC-09 | PASS | BLOCKED | test_save_confirmation | 实际拒绝保存与批准保存两条独立任务 |
| AC-10 | PASS | PASS | test_save_confirmation, test_tool_writes | 本项技术检查已完成；实际操作者的完整链路由 AC-08/09/11/21 保留，不据此宣称临床或生产通过 |
| AC-11 | PASS | BLOCKED | test_quality_review, test_final_clinical_review | 实际医生复核与自然触发的最终复核 |
| AC-12 | PASS | PASS | test_human_wait_restart, test_handoff_recovery, test_python_wait_recovery | 本项技术检查已完成；实际操作者的完整链路由 AC-08/09/11/21 保留，不据此宣称临床或生产通过 |
| AC-13 | PASS | PASS | test_worker_concurrency | 本项技术检查已完成；实际操作者的完整链路由 AC-08/09/11/21 保留，不据此宣称临床或生产通过 |
| AC-14 | PASS | PASS | test_stream_reconnect, test_chat_workflow | 本项技术检查已完成；实际操作者的完整链路由 AC-08/09/11/21 保留，不据此宣称临床或生产通过 |
| AC-15 | PASS | PASS | test_contracts, test_handoff_contracts | 本项技术检查已完成；实际操作者的完整链路由 AC-08/09/11/21 保留，不据此宣称临床或生产通过 |
| AC-16 | PASS | PASS | test_document_upload, test_knowledge | 本项技术检查已完成；实际操作者的完整链路由 AC-08/09/11/21 保留，不据此宣称临床或生产通过 |
| AC-17 | PASS | PASS | test_database_handoff, test_worker_concurrency | 本项技术检查已完成；实际操作者的完整链路由 AC-08/09/11/21 保留，不据此宣称临床或生产通过 |
| AC-18 | PASS | PASS | test_controlled_evidence | 本项技术检查已完成；实际操作者的完整链路由 AC-08/09/11/21 保留，不据此宣称临床或生产通过 |
| AC-19 | PASS | PASS | test_session, test_cutover_proxy, test_maintenance | 本项技术检查已完成；实际操作者的完整链路由 AC-08/09/11/21 保留，不据此宣称临床或生产通过 |
| AC-20 | PASS | PASS | test_maintenance, test_handoff_recovery | 本项技术检查已完成；实际操作者的完整链路由 AC-08/09/11/21 保留，不据此宣称临床或生产通过 |
| AC-21 | PASS | BLOCKED | test_handoff_contracts | 实际患者/医生完整 UI 实操，包含重启后的原等待继续 |
| AC-22 | PASS | PASS | test_workflow, test_workflow_inference | 本项技术检查已完成；实际操作者的完整链路由 AC-08/09/11/21 保留，不据此宣称临床或生产通过 |

当前仍需保留：实际参与者完整操作、依赖其继续的真实发布/保存闭环，以及补充样本去标识/外发范围确认。
Linux、训练校准、临床效果、托管 CI、生产升级/切流、合并与推送不在本轮通过范围。
