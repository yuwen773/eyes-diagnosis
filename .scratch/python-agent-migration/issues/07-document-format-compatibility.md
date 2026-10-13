# 07 — 补齐 .doc 与表格型 .docx 的上传检索

**What to build:** 用户上传旧版 Word 或以表格为主的 Word 文档后，正文有效内容进入知识库并可检索；解析失败与空文档被明确区分。

**Blocked by:** 01 — 建立可复现的现有 FastAPI 业务基线。

**Status:** ready-for-human — 2026-10-13；实现及可控验证见 `docs/document-formats.md`，真实服务与 Java 读端互通由 19 复核。

**Spec:** Python Agent 迁移与眼底诊断工作流 Spec（2026-10-12）。

**Acceptance mapping:** AC-16、AC-18；本票完成所列判据的相关部分，不代表提前通过整个 spec。

- [x] 提供受支持且可复现安装的 .doc 解析/转换方案，用实际二进制文档验证，不把重命名的 .docx 当 .doc。
- [x] 表格型 .docx 的有效单元格文本进入抽取、分块和向量入库链路；需要兼容的页眉页脚内容有明确处理与样例。
- [x] 从前端上传，经 HTTP、存储、抽取、embedding 到检索可得到有效片段，不仅测试解析 helper。
- [x] 错误输入、损坏文件与确实无有效文本分别给出明确失败，不以空向量或成功状态掩盖缺失能力。
- [x] 继续维护已有文档归属、集合、embedding 和 chunk ID 兼容，不顺便修既有分块语义。

## Verification

使用真实 .doc 与表格型 .docx 样例贯穿上传/检索接口；工程测试可控 embedding，真实 Chroma/embedding 在 19 复核。

2026-10-13：Apache Tika 3.3.2 固定 JAR 安装与官方 SHA-512 校验实际通过；真实 DOC/空 DOC 与生成 DOCX 贯穿 HTTP 回归。
Web 全量 501 passed、4 个生产模块 mypy、127 个依赖一致性检查通过；前端类型检查、生产构建、25 项测试通过。
原 Vue + HTTP 浏览器 4 项检查通过，使用合成身份、SQLite、COS/embedding/Chroma 边界替身与受控读取适配器。
Standards/Spec 双轴审查均 0 项遗留发现。结果、截图与审查见 `docs/document-formats/`。
本票不宣称真实服务、真实语义召回、Python 写→Java 读或整个 AC-18 已验收。

## Constraints

只在迁移 worktree 实施，保留原 Java 源码与构建配置；Java 继续拥有三个会话端点。沿用 release 的业务 ADR、MySQL 单一业务事实来源与图决定路由。正式业务写入须用户确认，医生复核另行执行。测试模拟与真实服务结果必须区分。没有修改、删除或发布源 spec 的任务。
