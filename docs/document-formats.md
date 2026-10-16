# 工单 07：Word 上传与检索兼容

> 历史记录（旧 Agent 迁移工单 07）。当前 DOC 安装与运行已由完整项目迁移工单 03 替换，
> 请使用 [无 JVM 文档解析与知识库](no-jvm-document-knowledge.md)。下文 Tika/JDK 命令只保留历史身份。

2026-10-13，工作树 `py-rewrite`，开始版本 `87121426f77ef1f1dd923a38341feb0dd73bc00d`。
仅覆盖 AC-16 和 AC-18 的工程可控部分。真实 MySQL、COS、Java 登录态、Chroma、
DashScope embedding、Java 读端联通仍由工单 19 复核。

## 安装与部署

Python 3.11 依赖沿用 `algorithm/requirements-web.lock`，新增固定的 `olefile==0.47`，
`python-docx` 最低版本调整为 1.2。`.doc` 使用 Apache Tika **3.3.2** 独立 CLI，
不启动额外 HTTP 服务、不修改 Java 源码或 Maven 配置。依赖与运行时的安装步骤都已实际执行。
版本依据：[Apache 下载说明](https://tika.apache.org/download.html)，
CLI 依据：[官方使用文档](https://tika.apache.org/3.3.2/gettingstarted.html)。

在 PowerShell 7、迁移工作树执行：

```powershell
Set-Location algorithm
uv pip sync --python .venv-baseline/Scripts/python.exe requirements-web.lock
$env:JAVA_HOME = 'C:\Users\yuwen\.jdks\corretto-21.0.7'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
& .venv-baseline/Scripts/python.exe -m web.doc_parser
& .venv-baseline/Scripts/python.exe -m pytest web/tests -q
```

安装器从 Maven Central 下载固定 JAR，使用官方公布的 SHA-512 校验后保存到
`algorithm/.tools/tika-app-3.3.2.jar`（忽略、不提交）。校验值来源：
[官方摘要](https://downloads.apache.org/tika/3.3.2/tika-app-3.3.2.jar.sha512)。
摘要固定在 `web/doc_parser.py`，校验失败不会覆盖已有安装。离线部署可复制同一已校验
JAR，使用 `TIKA_APP_JAR` 指定绝对路径；部署运行账号须能读取它并启动 Java 21。
Linux 同样安装 Java 21、设置 `JAVA_HOME`，执行相同 Python 安装命令。CI 的
`python-web` job 增加 Java 21 与解析器安装；本地通过不代表远端 CI 已运行。

请求期间不会联网下载解析器。每次 `.doc` 解析使用独立 Java 子进程，512 MiB 最大堆、
60 秒超时、stdin 输入，不拼接 shell 命令。缺少 JAR、Java 不可启动、超时、解析器失败均
返回解析失败原因；没有降级成空文本或伪造向量。

## 内容与错误语义

| 输入 | 行为 |
|---|---|
| Word 97–2003 `.doc` | 验证 OLE、WordDocument 流和 Word 文件头，然后用 Tika 抽取；拒绝重命名 DOCX、非 Word OLE、损坏/加密文件 |
| `.docx` 正文 | 按文档顺序读取段落、表格与嵌套表格；表格内部按行/单元格使用换行/tab；合并单元格只抽取一次 |
| `.docx` 页眉页脚 | 抽取默认页眉页脚、启用的首页/奇偶页内容；包含其中的表格；跨节共用的 part 只抽取一次，添加到正文之后 |
| 短内容 | DOCX 保留所有非空块，避免有效短单元格、页眉页脚被原 20 字阈值丢弃；其他格式保留原段落过滤与短文档回退规则 |
| 图片/扫描、批注、文本框、未接受修订 | 不新增 OCR、批注/文本框或修订合并能力；只有图片且没有有效文本属于空文档 |
| 损坏文件/格式不匹配 | 上传响应包含“文档解析失败”及原因；不保存对象、文档行或向量 |
| 有效空 Word/空文本 | 上传响应包含“文档内容为空”，与解析失败区分；不入库 |
| 混合批次 | 有效文件仍返回原 `data: List<Long字符串>`；失败文件名和原因放在 `msg`，页面显示警告；全部失败仍使用原业务错误码 50001 |

解析在上传响应前的线程池中完成一次，然后异步分块、embedding、Chroma 入库。
embedding/向量服务失败仍将已接收文档标记为 `status=2`；`status=1` 只在写入成功后设置。
原 ChromaWriter 的 add/delete 为同步接口，本票去掉错误的协程驱动，避免写入完成却
报告失败。集合 `diagnosis-knowledge`、tenant/database、`text-embedding-v3`、整数
`ownerUserId/documentId`、字符串 `docId`、`doc_{id}_chunk_{i}`、用户范围和原字符分块
（包括旧 rollover 重复追加行为）保持不变。未修改数据库 schema 或旧文档 ID。

## 验证与复现

真实二进制 `simple.doc`、`empty.doc` 的上游版本、SHA-256 和许可证见
`algorithm/web/tests/fixtures/documents/README.md`。DOCX 由测试生成，不用改扩展名模拟 DOC。
HTTP 回归 `test_document_upload.py` 贯穿 multipart 上传、对象存储、SQLite 文档行、
抽取、分块、真实 DashScope HTTP 客户端、真实 ChromaWriter 和受控读取适配器；
只在身份、数据库、COS、embedding HTTP transport、Chroma SDK 边界提供替身。
读取适配器按原 Java 的整数 `ownerUserId` 条件过滤，固定测试向量；不宣称真实语义召回
或 Python 写→Java 读已通过。

原 Vue 页面浏览器验证使用 `webapp-testing`/Playwright。分别启动以下服务，每次验证
使用新启动的测试后端（其内存数据随进程清空），只绑定 loopback，不部署测试模块：

```powershell
# 终端 1：algorithm 中，设置上面的 JAVA_HOME 后
& .venv-baseline/Scripts/python.exe -m web.tests.document_upload_ui_server
# 终端 2：frontend 中
$env:VITE_API_BASE_URL = 'http://127.0.0.1:15180/api'
npm run dev -- --host 127.0.0.1 --port 15181 --strictPort
# 终端 3：algorithm 中
& .venv-baseline/Scripts/python.exe -m web.tests.verify_document_upload_ui `
  --output-dir ../.scratch/baseline-runtime/issue07-ui
```

浏览器夹具提供合成管理员身份与测试专用 `/_test/search` 读取适配器，生产路由没有新增
搜索端点。验证器通过原文件选择控件上传真实 DOC 与表格 DOCX、等待已完成，再检查
受控检索片段；另检查损坏文件与空文档在页面显示不同原因。测试不使用真实账号或业务库。

本次结果及截图见 `docs/document-formats/`；代码审查见 `docs/document-formats/review.md`。
Web 全量 **501 passed**；4 个变更生产 Python 模块 mypy 通过；127 个锁定依赖一致性
检查通过；前端类型检查、生产构建和 **25 项测试**通过。生产构建仍有既有的大 chunk 提示。
