# 工单 19 双轴审查

基点：`bfaa01acd45e5346e4e374d9255a4afb5e91ad45`。
范围：本票暂存增量；不包含原有 `CLAUDE.md`、OMC 状态和其他工单运行文件。
独立 Standards 与 Spec 两个代理只读审查，完成后分别复核实现及验收边界。

## Standards

首轮 1 项 P1：普通 PR 工作流设置 `DASHSCOPE_API_KEY=''`，入口使用 `setdefault`
保留空值，导致受控提供商链路也无法执行。

修正：只要没有进入真实 embedding 模式，子进程环境显式设定受控测试密钥；
不再把空字符串或无效真实凭据传给受控适配器。类型检查含未标注函数体通过。
独立复审确认关闭该项，未发现新的规范或维护性问题。
完整空字符串 CI 等价运行证据另列在验收报告中，不能以代码复审代替实跑。

Java 原源码、原 `pom.xml`、源 spec 边界保留；密钥不进入可提交结果或 artifact，
真实服务、确定性模型和未执行层级分别记录。

## Spec

首轮 0 项：实现覆盖真实 API→MySQL→独立 Worker→生产图、原 Java 会话与旧 cookie
失效、Chroma 文档上传与范围/引用、新旧 HTTP/SSE 契约、角色/版本/本人确认等边界。
MySQL 竞争、租约和人工等待重启通过已有真实 MySQL 子进程套件复核。

供应商 401 与旧 Java Long 用户过滤缺陷分别为 BLOCKED；小用户 ID 检索通过不能
替代 Snowflake 用户兼容性，受控 embedding 不能替代真实语义召回。
源 spec、原 Java 源码与构建配置未修改。

总结：Standards 首轮 1 项、修正复审后 0 项遗留；Spec 0 项。测试执行结果见
[真实服务验收报告](real-services-ci.md)，报告中的阻塞不因审查无发现而自动通过。
