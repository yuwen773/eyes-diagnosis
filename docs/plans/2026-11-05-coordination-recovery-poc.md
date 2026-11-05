# 协调与恢复 PoC：实验记录

## 范围与结论

本实验位于 `src/test/java/com/csust/eyediagnosis/poc/`，不接入现有诊断、聊天、发布或正式记录接口，不使用 Flyway。固定输入为 `READY`，目标状态为 `WAITING_REVIEW`；Graph 由 `prepare` 和 `review` 两节点构成，领域方案使用直接状态迁移。两者共用受控时钟、MySQL 租约和事务实验代码。用例不调用模型、Python、COS 或临床服务。

本次使用 Java 21、Spring AI Alibaba Graph 1.1.2.2、MySQL 8.0.36 容器和 InnoDB。实验表只用于临时数据库，不能作为正式 DDL。提交前后的进程中断使用子 JVM 的 `Runtime.halt`，不是异常回滚；独立 JVM 从数据库读取 Graph checkpoint 并恢复。竞争测试使用独立 JDBC 连接；租约时间使用固定数值而非墙钟。

在上述范围内，观察到：业务状态、下一任务及 Graph checkpoint 可在一个 JDBC 事务中一起提交或回滚；新执行者取得更高令牌后旧执行者的提交被拒绝；重复提交不产生第二个下一任务；checkpoint 版本不符被拒绝。Graph 的 `MemorySaver` 在中断时保存 checkpoint，使用框架 `CheckPointSerializer` 序列化后放进同一业务事务；新 JVM 反序列化并放入新的 `MemorySaver` 后恢复。

**选型仍未决，正式 Saver DDL 不冻结。** 这里验证的是最小内存暂存和显式事务写入，不是框架内置 `MysqlSaver` 的事务接入证明，也未覆盖全部写入序列、并行节点、pending writes、心跳、时钟偏差、输入绑定或实际业务发布。手动领取只为两种编排提供相同调度条件，不构成调度器选型。PoC 不提供正式记录或发布功能，因此不能由此推断现有产品的发布幂等性或临床安全性。下一步应补齐这些协议和业务接口证据后再选择编排与调度方案。

## 复现

使用一次性的本地容器，若端口被占用则改用空闲端口；不要指向现有数据库。以下凭据仅属于一次性测试容器。容器就绪后运行，结束时仅停止此命令创建的容器：

```powershell
docker run -d --rm --name eye-coordination-poc-16 -e MYSQL_RANDOM_ROOT_PASSWORD=yes -e MYSQL_DATABASE=coordination_poc -e MYSQL_USER=poc -e MYSQL_PASSWORD=poc -p 127.0.0.1:33316:3306 mysql:8.0.36
docker logs eye-coordination-poc-16
# 在当前 PowerShell 会话先配置 JAVA_HOME 为 JDK 21 的安装目录
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
$env:COORDINATION_POC_URL = 'jdbc:mysql://127.0.0.1:33316/coordination_poc'
mvn '-Dtest=CoordinationPocTest,CoordinationMySqlTest' test
docker stop eye-coordination-poc-16
```

未设置 `COORDINATION_POC_URL` 时数据库用例跳过；必须检查测试报告中的 skipped 数，而不能把跳过视为通过。`CoordinationStore` 只允许名为 `coordination_poc` 的数据库，但调用方仍负责保证它是隔离实例。实验使用合成凭据和数据，不应连接共享或生产数据库。
