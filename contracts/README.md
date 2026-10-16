# 独立兼容契约

`legacy-api.json` 在工单 06 基点 `7efdc8c` 从保留的旧实现一次性提取端点、字段、
诊断文案和配置约定，并登记来源 SHA256。它是待评审的静态兼容契约，测试不会读取
Java 源码、Java 配置或调用 JVM，也不会从 Python 实现反推期望值。

新工作流、鉴权、医生复核和用户保存授权的行为继续通过 HTTP/Worker 测试验证。
数据库字段使用 `deploy/python-migrations/legacy` 的不可变迁移资产，源路径仅为审计
来源，不是部署或验收依赖。更新契约须说明对应批准的 API/兼容变更。

`diagnosis.proto` 同样从基点的 `src/main/proto/diagnosis.proto` 原样冻结，作为 Python
protobuf 生成入口的独立线协议。消息字段、编号及历史 Java options 保持不变；
生成仅调用 Python `grpc_tools.protoc`，不读取原 Java 工程目录。
