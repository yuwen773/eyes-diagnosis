# 医生复核冻结草稿（#20）

独立入口 `/doctor-reviews` 对应 [#20](https://github.com/yuwen773/eyes-diagnosis/issues/20)。使用 #19 的 `REVIEW_READY` 材料，不再调用模型、推理或检索新证据。医生只通过或不通过冻结版本；这不是患者发布或正式记录保存授权。

## 角色与任务授权

- 管理员通过既有 `/api/user/update` 将指定账号的 `userRole` 设为 `doctor`。角色注册为合法登录角色，普通用户个人资料更新不能设置角色。
- 管理员在独立入口填写已就绪任务 ID 和医生账号 ID，明确分配。医生账号必须存在、未删除且当前角色为 `doctor`；不得分配给患者本人。
- 一个任务只有一项分配。相同分配回放原记录，不同医生的重新分配返回 409；本期不提供转派、自动领取或改写决定。
- 医生只能列出、打开、提交分给自己的任务。管理员、领域资料审核人员、患者本人以及其他医生均不能读取这些复核材料或提交决定。登录身份由已有 `UserService.getLoginUser` 从数据库刷新。
- 未分配或医生未处理时持续等待，没有超时批准或 Agent 自动批准路径。列表每次最多返回最近 50 项已分配任务。

## 冻结与决定

V13 新增 `t_doctor_review`，不修改已应用迁移。分配时保存任务规范 ID、任务版本、输入和推理摘要、草稿版本、证据版本、冻结材料摘要及完整结构化材料。材料包括当前草稿、精确引用、Vision 限制和协作消息，保留修订前的 Critic 异议。

医生提交必须带回实际查看的任务、草稿、证据版本和材料摘要。服务重新比对当前任务输入、推理快照、草稿、引用与消息；变化时把待决复核置 `INVALIDATED`、任务置 `RESTRICTED`，提交失效状态后返回 409，不自动重新生成或替换证据。该终态需要后续人工处理或新任务，本期没有同任务重开接口。

批准前调用 `ControlledEvidenceRetriever.withValidatedEvidence`，检查精确的文档版本、治理版本、资格、审核人、标题、来源和片段内容/摘要。来源行锁持续到决定提交，与来源撤回串行化；锁顺序为来源 → 任务 → 复核。任务行锁与唯一任务约束保证并发决定只有一个先提交。已提交决定、意见、医生 ID、时间和冻结材料保持不变；完全相同的决定/意见/版本重试回放原记录，冲突请求返回 409。已经批准的回执在来源后来撤回时仍按原样回放，后续发布/保存必须独立复验，不能把回放当成新的放行。

批准及不通过均需填写非空意见，最多 2000 字。不通过不依赖来源当前仍有效，允许医生拒绝撤回的资料并保留原因，但仍须匹配冻结任务与材料。不通过将任务置 `RESTRICTED`。批准后任务保留 `WAITING_REVIEW` 的患者安全投影，等待 #21 的独立发布门禁；不返回草稿、证据或 Agent 消息，不创建正式诊断记录。

## HTTP 接口

统一使用 `BaseResponse`。业务鉴权错误为 `code=40101`，不存在为 `40400`，无效输入为 `40000`；版本/决定冲突为 HTTP 409、`code=40900`。复核响应设置 `Cache-Control: no-store`。Long 字段按项目 JSON 配置使用字符串。

| 方法与路径（`/api` 前缀） | 身份 | 内容 |
|---|---|---|
| `POST /doctor-reviews/assign` | 管理员 | `{taskId, doctorId}`；仅返回分配摘要，不返回草稿 |
| `GET /doctor-reviews` | 医生 | 本人获授权任务摘要 |
| `GET /doctor-reviews/{reviewId}` | 获授权医生 | 冻结材料、版本、决定与审计信息 |
| `POST /doctor-reviews/{reviewId}/decision` | 获授权医生 | `{expectedTaskVersion, expectedDraftVersion, expectedEvidenceVersion, expectedMaterialDigest, decision, note}`；`decision` 为 `APPROVED` 或 `REJECTED` |

前端提交后锁定已有决定；来源或版本冲突、网络中断时关闭材料并要求重新打开，避免重用旧表单。切换身份会清理材料并丢弃迟到响应。页面使用纯文本渲染草稿和资料，展示来源版本和协作历史异议。

## 测试边界

用户已确认：从医生复核 HTTP API、医生页面公开交互及患者状态 API 验证，使用隔离 MySQL、合成材料和受控身份。本地和 CI 的专项套件 `DoctorReviewApiTest` 共 36 项，必须实际执行且零跳过；`scripts/check_surefire_skips.py ... issue20` 检查报告存在、完整例数与跳过情况。未配置 `ISSUE20_TEST_URL` 时专项套件明确跳过，不算验收通过。

本功能的工程测试不代表真实医生资格验证、真实资料领域审核、模型临床有效性或生产验收。运行证据见 [本次验收记录](testing/2026-11-09-issue20-doctor-review-acceptance.md)。
