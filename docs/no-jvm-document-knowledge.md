# 工单 03：无 JVM 文档解析与知识库

工作树：`py-rewrite`；实施基点：`9dc9529`。只使用隔离样本、临时数据库和独立服务。
原 Java 源码、Maven、旧 SQL 和历史验收记录保留。

## 工具关卡与交付

选择 **LibreOffice 26.2.6.3**，build `8221e31b3ac356a1623c672912a3d2b492f7e3d1`。
先在独立解析入口验证 Windows/Linux DOC 样本，关卡通过后才接入正式上传。
DOC 经本地 Writer 转成 DOCX，再由既有 `python-docx` 提取正文、表格及有效页眉页脚。
原生 DOCX 上传直接使用 Python，不经过 LibreOffice。

Antiword 0.37 未采用：核验过 Debian 官方源码归档 SHA256
`4415e79d9f4c8d282a1cffbdaffe7ec0178982b9608e79bfd18561234a43e0cc`；
其 `Docs/ChangeLog` 将页眉页脚限定在 PostScript/PDF 输出，不能满足本票中文文本提取要求。
没有使用舍弃页眉页脚或 JVM 作为回退方案。

| 平台 | 官方归档 | SHA256 |
|---|---|---|
| Windows x64 | LibreOffice_26.2.6_Win_x86-64.msi | `f9877032fd908beb9c0ddf06df4af5c2e85f419c42e14876c4cce5aae5fb2660` |
| Linux x64 | LibreOffice_26.2.6_Linux_x86-64_deb.tar.gz | `fd0e8f8f2408dd2e5b90286e60f3f97cf566ba441cd48cfc5bcc68067303e0bc` |

依据：[Windows 官方摘要](https://download.documentfoundation.org/libreoffice/stable/26.2.6/win/x86_64/LibreOffice_26.2.6_Win_x86-64.msi.sha256)、
[Linux 官方摘要](https://download.documentfoundation.org/libreoffice/stable/26.2.6/deb/x86_64/LibreOffice_26.2.6_Linux_x86-64_deb.tar.gz.sha256)、
[官方 CLI](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html)、
[Writer 链接更新配置](https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26.2.6.2/officecfg/registry/schema/org/openoffice/Office/Writer.xcs)。
本机归档经 TUNA/USTC 镜像取得，按上面的官方摘要核验；不信任镜像自报版本。
摘要与实际 build 固定在 `algorithm/web/doc_tool.py`。

LibreOffice 采用 MPL 2.0，并包含其他开源组件；分发须保留归档内 `license.txt`、
`LICENSE.html`、NOTICE/CREDITS 及组件许可，不把整个归档简单标成单一许可。
本仓库不提交安装包或提取后的二进制，交付方式为部署时获取并核验官方归档、隔离解压。
来源：[官方许可证说明](https://www.libreoffice.org/licenses/)。

在 `algorithm/` 中显式安装（上传请求从不安装、下载或联网获取解析器）：

```powershell
# 使用 pwsh.exe -NoLogo -NoProfile 执行；先准备本地官方 MSI
& .venv-baseline/Scripts/python.exe -m web.doc_tool --archive '<本地 MSI 绝对路径>'
```

```sh
# Linux：先准备本地官方 DEB tar.gz、Python 3.11 与 dpkg-deb
python -m web.doc_tool --archive /absolute/path/LibreOffice_26.2.6_Linux_x86-64_deb.tar.gz
```

默认写入 `algorithm/.tools/libreoffice-26.2.6`（忽略、不提交）；安装器拒绝覆盖已有目录，
校验摘要后使用 Windows MSI 管理解包或 Linux `dpkg-deb -x`，不注册为桌面 Office。
安装完成核对实际 build 并记录 `eye-doc-tool.json`。自定义位置使用安装参数 `--home`
和运行变量 `DOC_TOOL_HOME`，二者须一致。运行账号只需读取工具目录、写入自身临时目录。
Linux 的 C/C++、fontconfig、X11/Cairo 等原生库须由基础镜像提供；此次 Ubuntu 22.04
环境的 `ldd` 检查和实际执行通过。Java 是 LibreOffice 部分其他功能的可选依赖，本路径禁用它。
CI 的 DOC 安装步骤已替换，尚未触发托管 CI；全项目 Java setup 清理由工单 06/08 负责。

## 内容和错误判据

原始样本在 `algorithm/web/tests/fixtures/documents/`，来源/生成器见该目录 README。
所有 DOC 都具有 OLE magic 和 `WordDocument` 流；不以重命名 DOCX 充当 DOC。

| 样本 | 独立预期 |
|---|---|
| simple.doc（Apache POI） | Word 97 正文的固定英文句子 |
| chinese-stories.doc（本地合成二进制 DOC） | 中文正文、合并单元格、眼底随访、嵌套复查、文档页眉、文档页脚均存在；无替换字符 |
| HeaderFooterUnicode.doc（Apache POI） | 页眉的欧元符号、页脚的 Molière；预期来自上游 TestHeaderStories |
| empty.doc（Apache POI） | 有效文档无文本，上传返回“文档内容为空” |
| PasswordProtected.doc（Apache POI） | FIB 加密标志导致明确拒绝，不启动转换 |
| 损坏 OLE/Word 流、伪装 DOCX | 解析失败；没有 COS 对象、数据库文档或空向量索引 |

DOC 与 DOCX 保留每个非空文本块，不再将短单元格、页眉页脚按 20 字符过滤。
已有 DOCX 的合并/嵌套表格及 default/first/even 页眉页脚回归继续执行。
不改变旧分块算法（包括已记录的重复追加缺陷），不清空集合、不自动重嵌入旧资料。

边界：仅支持 OLE Word 97–2003；拒绝加密/混淆文件，输入上限 20 MiB。
Linux 转换上限 60 秒、Windows 120 秒（隔离 Writer 配置/字体缓存冷启动有实际耗时证据）；
知识库批量上传的浏览器超时按每文件 150 秒（含子进程终止及清理）加额外 30 秒，
其余请求配置不变。Windows 短暂文件锁导致的清理失败会在 5 秒内重试，持续失败仍明确报错。
转换后 ZIP 和其解压总量各不超过 64 MiB。子进程不通过 shell 启动，stdin/输出关闭，
每次使用独立配置及临时目录，禁用宏、外部链接更新和 JVM。超时终止自己启动的进程树，
随后清理临时资源。安装缺失、超时、损坏和空内容不会静默生成空索引。
这些是执行与读取边界，**不是 OS 级内存/磁盘沙箱**。不承诺 OCR、批注、文本框、字段指令、
修订或任意损坏文件的无损恢复；超出代表性样本的复杂排版需要追加验证。

## 验证与证据层级

证据目录：`.scratch/python-project-migration/evidence/issue03/`。

- `red-parser.log`：独立入口先失败；`samples-windows.log` / `samples-linux.log`：双环境工具关卡。
- `linux-gate.json`：Ubuntu 22.04 / Python 3.11，JAVA_HOME 移除、PATH 找不到 java。
- `red-http/results.json`：旧上传路径在无 Java PATH 下失败；私有 API 日志定位到 Tika 启动。
- `red-short-stories.log`：接入新工具后，旧段落过滤仍丢短内容；随后保留 Word 非空块。
- `windows-infrastructure/results.json`：真实 MySQL 8.0.26、Redis 3.2.100、Chroma TCP 验证。

真实 Chroma 验证使用独立数据目录，collection 保持 `diagnosis-knowledge`，
`doc_{docId}_chunk_{i}`、整数 `ownerUserId`/`documentId`、字符串 `docId` 与默认 1024 维契约不变。
测试预置原文档/向量，上传后比对其文本、metadata 和向量未变；大于 JavaScript 安全整数的
用户 ID 经 Python 登录上传、检索和越权拒绝验证。引用摘要由检索响应独立校验。
MySQL 只创建 `eye_doc_issue03_*` 新 schema，Redis/Chroma/API/供应商替身都是独立子进程；
结束后回收自己启动的进程，验收数据保留用于复核。

复跑真实基础设施：

```powershell
# 在 algorithm/，由环境注入仅指向本机的 REAL_SERVICES_MYSQL_ADMIN_URL（无数据库名）
& .venv-baseline/Scripts/python.exe -m web.verify_document_knowledge `
  --redis-server '<本地 redis-server 绝对路径>' `
  --output-dir ../.scratch/python-project-migration/evidence/issue03/windows-infrastructure
```

Embedding HTTP 和 COS 使用受控边界；真实语义检索未验证。旧真实 embedding HTTP 401 阻塞
保留且本票未重跑。真实 COS、其他模型/供应商、临床、生产升级/切流均未验收。
Linux 的上传/权限回归使用受控身份/SQLite，真实 Chroma 另有本地 TCP 回归；不宣称 Linux
已完成真实 MySQL/Redis 部署验收，也不宣称整个项目已移除 JVM。

## 最终回归与复核（2026-10-16）

| 验证层次 | 结果 | issue03 下的原始证据 |
|---|---|---|
| Windows 最终完整 Web，无 Java PATH/JAVA_HOME | 787 passed、28 skipped、1 warning，707.77 秒 | `windows-full-final.log`、`windows-final.xml` |
| Linux 最终相关回归，无 Java PATH | 104 passed、1 skipped，32.31 秒；包含最终清理修复及 HTTP DOC/DOCX、权限、真实本地 Chroma | `focused-linux-final.log` |
| 前端构建（含 vue-tsc） | PASS；既有大 chunk 提示 | `frontend-build-final.log` |
| 前端回归 | 47 passed / 12 files | `frontend-tests-final.log` |
| 最终 Python 类型检查 | 6 个模块 PASS，收尾仅补存日志 | `mypy-final.log` |
| Windows 真实基础设施 | MySQL 8.0.26 / Redis 3.2.100 / Chroma TCP PASS；embedding、COS 受控 | `windows-infrastructure/results.json` |
| Linux 完整 Web（早于最终清理修复） | **FAIL：781 passed、5 failed、28 skipped** | `full-linux-web.log`、`linux-web-results.xml` |

Linux 全量失败涉及模型选择、HTTPS MCP、工作流及 Snowflake 时钟回退（1097ms），
本票未扩大修改这些模块。最终相关回归通过不替代 Linux 全量门禁；后续工程票须处理或复核，
不宣称 Linux 完整部署通过。Windows 最终全量通过后未修改实现，收尾未重复运行全量。

保留先 RED 后 GREEN 的过程：独立入口缺失、无 Java 的旧 Tika 上传失败、短段落过滤丢内容，
以及 Windows 临时文件锁清理失败均有原始日志。首轮 Windows 全量为 781 passed / 5 failed /
28 skipped；本票转换超时与文件锁问题修复后最终全量全部通过。其余三个工作流用例在
`9dc9529` 隔离快照重跑 3 PASS（`baseline-regressions.log` / XML），不删除首轮失败。

交接已完成的并行双轴复核：**Standards 0 findings；Spec 0 findings**，覆盖主 diff、
Windows/浏览器超时调整及最终清理修复。收尾仅更新证据/状态，没有新增实现变更或重跑复核；
来源与范围见 [review.md](../.scratch/python-project-migration/evidence/issue03/review.md)。

工单为 `ready-for-human` / `PASS_WITH_LIMITATIONS`，8/8 判据仅覆盖上述支持范围。
完整验收边界、原始失败、最终结果及源码摘要见
[证据索引](../.scratch/python-project-migration/evidence/issue03/README.md) 和
[机器汇总](../.scratch/python-project-migration/evidence/issue03/verification-summary.json)。
`source-sha256.json` 使用最终 Git 暂存区文件字节（文本按 Git 规则规范化）的 SHA256，
避免 Windows 工作区 CRLF 与提交中的 LF 差异；`fixtures.json` 继续校验原始 DOC 二进制字节。
