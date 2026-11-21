# 四 Agent 自治正式流程 B：实现与验收

完成日期：2026-11-11；真实提供方运行日期：2026-11-10。

## 结果与范围

用户确认的 [B 变更规格](../plans/2026-11-10-autonomous-four-agent-spec-proposal.md) 已实现：新任务走 `AUTONOMOUS_V2`，四角色使用任务内独立收件箱；Vision/Evidence 首轮并行，后续角色由通过校验的定向消息及版本依赖驱动。管理员三个视图读取真实持久化轨迹，模拟事件常量已移除。

本次完成的是代码、工程专项、两次有界真实模型运行及浏览器验证。**未部署，未提交、推送、合并或修改 issue 状态；未执行全量后端、临床或生产验收。** 同一工作树已有的算法/OOD 和其他未提交工作予以保留。

工作树 HEAD 为 `74cf7d8246c6fb30ad58bd0497f8e08f94be749f`，本次代码尚未提交。当前源码逐文件 SHA-256 见 [最终源码清单](autonomous-four-agent-live-20261110/source-manifest-final.json)，不能把 HEAD 当作已包含本次改动的提交。

## 实现要点

- `PatientDraftCoordinator` 内部事件循环消费角色完成事件；两个模型执行槽位、队列和任务内在途数均有界。截止时间在领取时固定，等待过程中不高频查询数据库。
- `DraftMailbox` 为消息绑定规范任务 ID、流程版本、发送者/收件人、原因、推理摘要和证据/草稿版本；重复同一消息不重新驱动角色，不同材料复用消息标识或非法路由会被拒绝。
- 模型开始时间、完成时间及消息接受发送时间分别记录。完成时刻由模型线程捕获，避免把事件循环中的冻结等待误算进模型耗时。
- 每任务保持最多 8 次模型调用、总计 90 秒、单次 20 秒、一轮反馈（最多补证一次、重写一次）。首轮两次调用可均已预扣，失败和取消不退额度；一个角色失败后停止运行并取消兄弟请求，迟到结果不能写入或放行。
- Explanation 的模型输入只含证据索引、版本和片段原文；完整来源仍冻结并提供给 Critic/医生。六区段、引用逐字子串、来源持锁复验及医生批准要求保持有效。
- `collaboration.inbox/outgoing` 与角色材料存于原消息 JSON，进入医生冻结材料摘要；不修改既有摘要算法或历史消息字节。V17 仅为运行记录增加流程版本，旧记录默认 `SEQUENTIAL_V1`。
- ①、③保留同角色多次调用；②按真实起止、实际寻址消息和材料版本呈现事件。任务/身份变化清理旧材料并丢弃迟到响应，重播不调用模型。

## 工程验证

环境：JDK 21、一次性 MySQL 8.0.36、隔离合成测试库；外部模型和身份由受控替身提供。

| 专项 | 实际用例 | 失败 / 错误 / 跳过 |
|---|---:|---|
| `PatientDraftTest` | 41 | 0 / 0 / 0 |
| `DoctorReviewApiTest` | 36 | 0 / 0 / 0 |
| `PatientExplanationApiTest` | 37 | 0 / 0 / 0 |
| `PatientAuthorizationApiTest` | 37 | 0 / 0 / 0 |
| `FlywayMySqlIntegrationTest` | 3 | 0 / 0 / 0 |
| `UploadTaskMapperMySqlIntegrationTest` | 3 | 0 / 0 / 0 |
| 合计 | **157** | **0 / 0 / 0** |

逐用例结果见 [专项报告摘要](autonomous-four-agent-live-20261110/engineering-suite-results.json)。这是同一源码周期内分次运行的专项汇总，并非一次全量后端运行。最后的草稿与迁移/Mapper 专项针对最终后端源码重跑通过。

新增行为涵盖：同步屏障证明首轮两个角色同时进入提供方、实际收件及来源元数据隔离、兄弟请求失败后及时受限且迟到结果不改变报告、仅剩一次额度时不能超支。既有补证、重复异议、来源撤回、引用失败、幂等、独立 JVM 崩溃及安全患者投影测试继续运行。

保存专项新增两个完整链路场景：自治生成 → 医生冻结/批准 → 患者读取 → 明确授权保存；以及篡改协作信封后保存被拒。迁移验证空库、V14 账户保留和 V16→V17 历史消息不变。

跳过门禁 `issue19/issue20/issue21/issue22/flyway` 均通过；门禁自身 18 项测试通过。修复了既有夹具依赖旧用户表形状、无列名消息插入及不一致的用例计数。一次性容器的触发器故障注入需要临时测试设置，已在该专项完成后恢复；未调整宿主或生产数据库权限。

前端最终全量 **72 项通过**；改动文件 ESLint 无错误，`npm run build`（包含类型检查）通过。构建仍提示既有较大 chunk，不影响本次构建结果。

## 真实提供方：两次合成任务，合计 7 次调用

真实模型为已配置的 `qwen3.5-plus`，关闭 thinking；原始图片推理和受控资料均为明确标注的合成夹具，不是完整真实图像/临床链路。凭据未入库。

| 合成标签 | 结果 | 调用数 | 总耗时 | Vision/Evidence 真实重叠 |
|---|---|---:|---:|---:|
| other | `RESTRICTED / INVALID_CITATION` | 3 | 8,188 ms | 1,561.516 ms |
| glaucoma | `REVIEW_READY` | 4 | 10,569 ms | 1,631.171 ms |

原始结构化轨迹：[other](autonomous-four-agent-live-20261110/1-other.json)、[glaucoma](autonomous-four-agent-live-20261110/2-glaucoma.json)；[调用账本](autonomous-four-agent-live-20261110/ledger.json)记录两个任务及预算。未创建替代任务或追加付费重试，远低于获准的 16 次调用上限。

成功任务四角色全部返回，六区段引用通过确定性校验，Critic 为 `NONE`；受限任务仍保留拒绝证据。**移除标题/来源没有解决全部引用可靠性问题，1/2 成功不能视为可靠性或临床达标。** 真实模型本次没有触发反馈，补证/重写路径的证据来自工程替身，不声称真实模型已验证该路径。

真实运行后只补充非法路由/冲突拒绝保护及前端时间、主题修正，未再次付费调用；最终源码与真实运行覆盖范围分别在清单中注明。

## 浏览器与审查

最终浏览器核验使用当前开发源码及真实后端读取上述任务：三个视图实际点击、就绪任务四泳道和真实消息、重播、受限任务、明暗主题、390px 窄屏。完成 **7 项检查、6 张截图、0 个未捕获异常**；前后模型调用数仍为 3 和 4。

截图及机器摘要见 [浏览器证据](autonomous-four-agent-browser-20261110/summary.json)：[浅色泳道](autonomous-four-agent-browser-20261110/01-autonomy-ready-light.png)、[深色泳道](autonomous-four-agent-browser-20261110/02-autonomy-ready-dark.png)、[窄屏深色](autonomous-four-agent-browser-20261110/03-autonomy-mobile-dark.png)、[调用视图](autonomous-four-agent-browser-20261110/04-runtime-real.png)、[对话视图](autonomous-four-agent-browser-20261110/05-chat-real.png)、[受限任务](autonomous-four-agent-browser-20261110/06-autonomy-restricted.png)。使用独立无头 Chrome/CDP 与测试 profile，未改动用户已有浏览器标签；本机未使用 Playwright。

浏览器发现并修复了持久化 Instant 的 epoch 秒格式导致 `NaN`、暗色文字背景不匹配、窄屏侧栏挤压问题。深色样式经 Vue 实际编译确认仅限定本页面，未向整个应用注入 Iris 别名。

按 `code-review` 进行 Standards 与 Spec 两路只读审查并复查：发现的完成时间失真、高频数据库查询、停止文案和 CSS 作用域问题均已修复；两路无剩余实质发现。审查意见不代替运行测试。

## 本地查看与边界

最终预览为 `http://localhost:5184/admin/agent-collab`，配套独立开发后端，仅读取已生成的任务。原有开发实例予以保留。预览后台自动接单和合成 seed 入口均关闭，模型凭据使用不可用测试值，避免浏览器查看意外产生付费调用。

正式接入仍由已有 `eye-diagnosis.draft.enabled` 开关控制，默认关闭。开发预览不是部署。全量后端、真实模型反馈路径、真实医学资料/图片联合验收、临床有效性和生产验收均未以本次专项结果替代。
