# Ticket 02 双轴复核

基点：`eb766deb9056cdb17023395cd6eda26926e7ff7e`，复核当前工作树改动与新增文件。
范围为登录鉴权、会话测试夹具、OpenAPI、验证脚本与当前说明；排除既有 `.omc`
删除、其他工单证据、未提交的完整迁移规划资产和 CLAUDE 旧增量。

## Standards

初次发现：real-services 验证脚本新增的 `legacy` 客户端映射被后续 `.doc` 文档变量
覆盖，导致 `KeyError`。已将映射参数改名为 `legacy_clients`；复审确认全部调用一致。
无遗留可执行标准问题。

非阻塞兼容观察：GET-only 会话与 Spring 闲置超时不同。实施已加入 EXPIRE 续期，
不会重建已删除 key；受控与真实 Redis 验证了续期及过期。

## Spec

初次发现：缺失/null 登录字段在 Pydantic 层提前返回英文校验消息，没有保留原
`参数为空`。已允许 DTO 缺失/null，按原顺序校验，五个 HTTP 回归 red→green。
复审重新执行原复现，确认 HTTP 200 / code 40000 / 参数为空。无遗留 Spec 问题。

另审查并关闭：同步身份 SQL 阻塞事件循环（线程池 + HTTP 并发回归）、
Redis 故障的工作流 HTTP 500 映射、MD5 升级在成功响应前提交。
双轴复审未发现新的安全/回归问题；复核代理未执行全套，最终验证由主任务完成。

## 验证补充

真实 TCP 复现了 MD5 升级提交与响应竞争，确认旧实现仅最终提交；已改为响应前
commit，最终真实 MySQL/Redis + Vue 验证通过。UI 辅助服务探针补出了 reconnect
夹具被 monkeypatch 的 AsyncClient 重复 transport 参数，现改为保留原类引用；
tool-writes 夹具也改为初始化新会话夹具已创建账号的简介，不重置已有资料。

历史 real-services/切流全场景未重跑，不以静态修复和启动探针冒充完整验收。
所有结果与边界见 [验证记录](../../../../docs/python-session-auth-evidence.md)。
