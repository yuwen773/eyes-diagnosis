# 受控眼科参考资料（#18）

受控资料入口为 `/controlled-references`。它与个人知识库、普通聊天 RAG 分离；现有资料不会自动晋升为临床证据，也没有默认获准的真实语料。

## 角色与审核

- `admin` 上传、查看和删除候选资料。
- `evidence_reviewer` 查看原始文件和解析片段，维护疾病/主题范围、可见范围和启用状态，批准或撤回资料。管理员不会自动拥有领域审核权限；上传者不能批准自己的资料。
- 其他角色不能读取候选资料或调用管理操作。角色取自服务端重新读取的登录用户，不能由请求参数指定。
- 由管理员通过现有用户管理 API 分配 `evidence_reviewer` 给实际指定的领域人员。本功能不会自动授予任何现有账号该角色；工程测试身份不代表真实领域资质。

上传默认 `PRIVATE_USER`、`PENDING`，且默认标识为测试资料。真实资料须显式取消测试标识，再由领域人员核对原始文件、出处、解析完整性和适用范围，填写审核说明并确认完成领域审核。测试资料即使批准也始终排除于临床检索，测试标识不能在上传后修改。

原文件和解析片段不可覆盖。`documentVersion` 是原文件字节的 SHA-256；内容修订须重新上传，产生新的文档 ID 和版本快照。审核/撤回/范围或启用状态修改会增加 `governanceVersion`；客户端必须提交所见版本，陈旧决定返回 HTTP 409。保存范围可将资料置回待审，重新批准需要重新完成领域审核。删除是保留原始快照的逻辑删除，也立即废止资格。

## 管理接口

以下路径相对后端 `/api`，正常响应使用 `BaseResponse`；需携带登录会话。

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/controlled-references` | 单文件 multipart：`file`、`title`、`source`、`isTest`（默认 true） |
| GET | `/controlled-references?page=1&pageSize=20` | 管理目录，pageSize 不超过 100 |
| GET | `/controlled-references/{id}` | 元数据、审核范围、完整解析片段及摘要 |
| GET | `/controlled-references/{id}/file` | 按附件下载原文件，禁止缓存 |
| POST | `/controlled-references/{id}/governance` | 带预期治理版本的审核决定 |
| DELETE | `/controlled-references/{id}?expectedGovernanceVersion=N` | 管理员逻辑删除 |

治理请求包含 `expectedGovernanceVersion`、`reviewStatus`（`PENDING` / `APPROVED` / `WITHDRAWN`）、`visibility`（`PRIVATE_USER` / `CURATED_PUBLIC`）、`diseaseCodes`、`topicCodes`、`enabled`、`domainReviewed` 和必填 `note`。批准须有非空疾病/主题范围并确认领域审核。

## 检索与冻结引用

`ControlledEvidenceRetriever.retrieve(diseaseCode, topicCode, query)` 是服务端接口，不向模型暴露资格管理能力。疾病/主题由工作流绑定，不能以模型输出替代授权。第一版复用现有解析器、分块器及中文分词器，在合格片段中按查询词命中数排序，最多返回五条；未接入向量、RRF 或 rerank，召回质量仍须单独评估。

所有条件必须同时满足：未删除、启用、非测试、受控公开、审核通过、疾病及主题精确匹配。引用冻结文档 ID、内容版本、治理版本、片段索引、原文和 SHA-256、审核人/状态及检索时间。检索不使用聊天缓存，不接收普通 RAG 的格式化字符串作为资格证明。

`withValidatedEvidence(diseaseCode, topicCode, frozen, action)` 只复验冻结来源，不自动替换引用。它按固定顺序锁定来源行，再核对当前资格、版本、出处、原文和片段摘要。空证据集、删除、撤回、停用、私有化、范围变化或版本/摘要不一致都拒绝消费；撤回再批准也不能复活旧治理版本。

后续发布、医生确认和保存功能必须把相关数据库写入放入 `action`，使用同一 DataSource 及 Spring 事务。来源行锁持续到事务完成，治理更新与资格使用据此排序。不要先校验后在另一个事务中保存，也不要在回调中执行无法回滚的外部副作用。本任务提供这一边界；四 Agent、患者发布和保存流程由后续任务接入，不以本任务的接口测试声称那些流程已完成验收。

## 验证

V11 新增独立的资料与片段表，不修改已应用迁移。真实 MySQL 接口测试只接受 `jdbc:mysql://127.0.0.1:<port>/issue18_test`，使用专用测试账号，测试语料均为明确标注的合成文本。未设置 `ISSUE18_TEST_URL` 时这些测试跳过；不能把跳过当作通过。前端组件用 HTTP 替身测试，不等于真实登录、领域审查或临床验收。

CI 的 `issue18-mysql` 作业运行全部 13 个用例，并通过 `scripts/check_surefire_skips.py ... issue18` 检查用例数和零跳过。普通后端作业未提供该专用数据库时允许明确跳过这 13 例，缺失报告仍会失败。
