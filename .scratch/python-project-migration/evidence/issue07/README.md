# 工单 07 验收证据

日期：2026-10-16（Asia/Shanghai）。工作区 `py-rewrite`，基点 `5733cf3`。

- [最终机器汇总](verification-summary.json)
- [实际隔离演练](accepted/rehearsal.json)：两个故障分支，四类等待，真实旧槽回退，
  写入后止写及 Python 修复，MySQL 独立恢复库和 Chroma/对象保全。
- [演练 JUnit](rehearsal-final.xml)、[原始日志](rehearsal-final.log)。
- [真实 Nginx 5 项门禁](admission-final.xml)、[日志](admission-final.log)：停写、登录和
  查询、纯 Python 路由、恢复写入后拒绝旧槽、锁与保留文件名保护。
- [Windows 全量 Web](full-windows/web.xml)、[共同入口日志](full-web.log)。
- [新增 3 文件类型检查](mypy-final.log)、[两轴审查](review.md)、[故障说明](diagnosis.md)。
- [源码和证据摘要](source-sha256.json)。

摘要按 Git 暂存/提交字节计算；Markdown 等文本遵守仓库既有换行规范化，原始
JSON/日志/XML 使用本目录属性保留捕获字节，不以重写原证据消除 CRLF 检查差异。

最终演练：首次连续停写 **34.578 秒**，其中写入前切换/故障/退旧槽阶段 24.968 秒，
再次准备 Python 恢复写入阶段 8.969 秒，另包含两阶段间旧槽退出时间。
写入后故障到修复验证完成 **19.985 秒**，演练主流程 **102.985 秒**；pytest 含
准备/清理为 113.04 秒。维护时长仅针对本次小规模合成数据，不是生产停机 SLA。

`accepted/*before-*.json` 是固定旧 Python 提交生成的四类合成等待快照；最终
`test_first_cutover_prewrite_ro0.json` 记录 API/Worker PID、状态/回执与外部调用轨迹。
`accepted/rehearsal.json` 保存全表摘要、对象/向量引用、旧 JAR/源码/Python 产物摘要、
备份文件摘要、恢复隔离库名与网关不可退旧版账本。原始转储、RDB、对象、Chroma 文件、
旧 JAR 和配置日志在该 JSON 指向的忽略私有运行目录中，不提交其账号哈希或秘密。

`red-*`、`rehearsal-attempt01` 至 `rehearsal-attempt06`、`attempt*`、`before-review`
保留失败/阶段性通过历史，不能当作最终结果，也不改写为 PASS。具体原因见故障说明。
真实模型/embedding/LLM/COS 与临床未验收；本票未执行 Linux 切换、托管 CI、生产升级/
切流、push、历史标签创建或工单 08。工单 06 的双环境工程证据独立保留。
