# 工单 03 证据索引

2026-10-16（Asia/Shanghai）；实施基点 `9dc9529e68c0f0e0a9a325f367ec712078b4de07`。
收尾复用交接前完成的最终回归，仅重新归档最终 mypy；没有修改实现或重跑全量。

## 最终结果

- Windows 完整 Web：787 passed、28 skipped、1 warning；`windows-full-final.log`、`windows-final.xml`。
- Linux 最终相关回归：104 passed、1 skipped；`focused-linux-final.log`。使用受控身份/SQLite，包含本地真实 Chroma 回归。
- 前端：构建含 vue-tsc PASS，47 tests / 12 files PASS；`frontend-build-final.log`、`frontend-tests-final.log`。未重跑浏览器实操。
- Python：6 个模块 mypy PASS；`mypy-final.log`。
- 依赖一致性：`uv pip check` PASS；`dependency-check-final.log`。
- 真实 Windows MySQL/Redis/Chroma：`windows-infrastructure/results.json`；3 分块、整数 metadata、大 ID 隔离、引用摘要及旧文档/向量保留。
- 双环境安装/工具关卡：`install-windows.log`、`install-linux-tool.log`、`linux-gate.json`、`samples-windows.log`、`samples-linux.log`（各 5 PASS）；上游 Unicode 补充见 `upstream-windows.log`。

## 失败与修复历史

| 原始失败 | 后续证据及解释 |
|---|---|
| `red-parser.log`：独立入口缺失 | `green-parser.log` 及双环境工具关卡 |
| `red-http/results.json`：无 Java 的旧 Tika 上传失败 | `windows-infrastructure/results.json` 正式新解析器闭环通过 |
| `red-short-stories.log`：短块过滤丢内容 | 最终上传保留 DOC/DOCX 非空块，最终全量及基础设施验证通过 |
| `full-web-suite.log` / `web-results.xml`：首轮 Windows 781/5/28 | 转换超时、文件锁修复；`empty-http-recheck.log`、`windows-failure-rechecks.log`；最终 `windows-full-final.log` 787/0/28 |
| `red-cleanup.log`：公开 extract_doc 边界复现文件锁 | `green-cleanup.log`：清理、超时回收及安装摘要拒绝 3 PASS |
| 首轮 Windows 另三个工作流时序失败 | `baseline-regressions.log` / XML：基点隔离快照 3 PASS，保留失败历史 |
| `full-linux-web.log` / `linux-web-results.xml`：Linux 全量 781/5/28 | **仍为 FAIL**；模型、HTTPS MCP、工作流及 Snowflake 时钟回退 1097ms 待后续工程票复核，最终相关 104/1 不替代全量 |

## 摘要与复核

- `fixtures.json`：5 个真实 DOC 样本的原始字节 SHA256，收尾重新核对，样本未改动。
- `source-sha256.json`：本票最终源码/测试/CI/前端请求配置的 Git 暂存区字节 SHA256。文本按 Git 规则规范化，避免 Windows CRLF 与提交 LF 差异。
- `verification-summary.json`：各层结果、8 条判据映射、失败历史与未验证边界。
- `review.md`：交接已完成的 Standards / Spec 两轴复核，各 0 findings；收尾未冒充新的代理复核。

原始日志保留捕获字节；部分 WSL 输出包含混合编码提示/NUL。目录内 `.gitattributes` 仅对
日志/XML 禁用换行转换和空白告警，以保留 traceback 自带空格；源码、JSON 和文档仍执行常规检查。
不改写原日志。数据库、安装包、
工具目录、运行进程日志、隔离快照、探测脚本和其他工单资产不纳入本次提交。

Embedding/COS 受控；真实 embedding 历史 HTTP 401 阻塞未重跑，真实语义检索未验收。
真实模型/供应商、COS、临床、完整 Linux 部署、托管 CI、生产升级/切流未验收。
Java 资产保留，不能将 DOC 无 JVM 通过推广为全项目已移除 JVM。
