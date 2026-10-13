# 工单 06 独立双轴审查

日期：2026-10-13（Asia/Shanghai）。基点：`97b6e1dc686c3fe1d1966c3a3d89f0b1d2766f30`。
两名独立只读审查者分别执行Standards与Spec审查，范围限定本票文件。
原有CLAUDE.md、.omc删除及其他工单/spec草稿不在审查或提交范围。

## Standards

未发现可行动问题。Vue使用Composition API/TypeScript并沿用现有设计变量；共享服务
提供同一创建/幂等/患者投影；ORM与DDL沿用小驼峰，V18追加，未改Java或旧迁移。
改动集中于本票接口、关联存储、必要UI及验证。没有需要整改的smell baseline判断项。

## Spec

初审发现两项P2，均已修复并通过独立复审：

1. 待确认请求切换到新对话后失去恢复入口，阻断新诊断。现从任何会话可点击重试，
   返回原会话并沿用原幂等键；刷新可恢复尚无服务端会话的待确认请求。
2. 延迟返回的历史响应可能把旧任务显示到新对话。现使用请求代次和会话匹配检查，
   切换、新对话、返回待确认与卸载均使旧历史加载失效，不写入任务、URL或消息。

复审核对修复和浏览器记录，未发现本票剩余可行动需求问题。最后追加待确认请求按登录
用户隔离的静态复审，防止同一标签页换用户后恢复其他用户的待确认请求。审查者未独立重跑
全部测试。共享创建、权限、SSE标识、普通聊天和追加迁移未发现额外缺口或越界。

## 验证记录

- Python Web全量：488 passed，0 skipped。
- 前端：25 passed，Vue类型检查与生产构建通过；仍有原有大chunk提示。
- 变更Python模块mypy：通过；全旧Web目录mypy有既存域/测试错误，未声称全目录通过。
- 隔离真实MySQL 8.0.26：Flyway V1–V18 migrate/validate通过，5项新增HTTP/SSE通过。
- 原Vue/Chromium：9项实际HTTP/SSE/Worker检查通过，pageErrors为空。

详见[实现与复现](../chat-workflow-binding.md)、[数据库结果](issue06-mysql-results.json)和
[浏览器结果](issue06-ui-results.json)。浏览器使用临时SQLite；所有Java身份/COS/聊天
模型调用是替身，缺真实模型权重明确MODEL_UNAVAILABLE。未切换或部署现有服务。

结论：Standards 0项；Spec 初审2项P2，已解决，剩余0项。真实模型及整个迁移验收未完成。
