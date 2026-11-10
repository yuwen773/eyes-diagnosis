# 协调与恢复 PoC：实验记录

## 范围与结论

本实验位于 `src/test/java/com/csust/eyediagnosis/poc/`，不接入现有诊断、聊天、发布或正式记录接口，不使用 Flyway。固定输入为 `READY`，目标状态为 `WAITING_REVIEW`；Graph 使用两节点及节点间中断，领域方案使用直接状态迁移。两者共用受控时钟、MySQL 租约和事务实验代码。用例不调用模型、Python、COS 或临床服务。

本次使用 Java 21、Spring AI Alibaba Graph 1.1.2.2、MySQL 8.0.36 容器和 InnoDB。实验表只用于临时数据库，不能作为正式 DDL。提交前后的进程中断使用子 JVM 的 `Runtime.halt`，不是异常回滚；独立 JVM 从数据库读取 Graph checkpoint 并恢复。竞争测试使用独立 JDBC 连接；租约时间使用固定数值而非墙钟。

在上述范围内，观察到：业务状态、下一任务及 Saver 写入可在一个 JDBC 事务中一起提交或回滚；首次执行与恢复阶段均测试了提交前后子进程强制退出、过期租约接管及重启。两个独立连接同时领取恢复任务时只有一个成功，旧令牌不能提交状态、完成记录或新的 Saver 写入。两种方案各自计算恢复状态；重复恢复不会重复写入 PoC 完成标记。恢复进程拒绝错误的引擎和不兼容的 Saver 版本。

对于本次两节点图，代理 Saver 观察到首次调用序列 `get → put(__START__→prepare) → put(prepare→review)`，恢复调用序列 `get → put(review→__END__)`。每次 `put` 均使用框架 `CheckPointSerializer` 序列化并在内存暂存；业务事务通过租约栅栏后按顺序写入，重启时按原始选择的 checkpoint ID 重放。恢复写入与完成标记同事务提交或回滚。`list` 未被这个场景调用；`release` 在该 PoC 中明确拒绝，未作为已支持能力。提交前崩溃的暂存写入丢失，重启从上次提交恢复，计算或外部调用可能再次执行。

**建议下一阶段先采用领域状态机作为协调候选，Graph 保留作进一步验证的候选；正式 Saver DDL 不冻结。** 在这个固定场景中两者达到相同的受控结果，但 Graph 额外需要捕获、序列化、重放和事务协调 Saver 写入。该结论是工程 PoC 建议，不是完整工作流或生产验收。这里没有证明框架内置 `MysqlSaver` 可参与业务事务，也没有验证其他图形、并行节点、`list` / `release` 的持久化语义、pending writes、心跳、时钟偏差、输入摘要绑定或真实业务发布。模拟完成标记不是诊断正式记录，因此不能据此断言实际系统的发布幂等性或临床安全性。手动领取提供相同调度条件，不构成调度器选型。

## 复现

使用一次性的本地容器，若端口被占用则改用空闲端口；不要指向现有数据库。以下凭据仅属于一次性测试容器。容器就绪后运行，结束时仅停止此命令创建的容器：

```powershell
$pocContainerId = docker run -d --rm -e MYSQL_RANDOM_ROOT_PASSWORD=yes -e MYSQL_DATABASE=coordination_poc -e MYSQL_USER=poc -e MYSQL_PASSWORD=poc -p 127.0.0.1:33316:3306 mysql:8.0.36
if ($LASTEXITCODE -ne 0) { throw 'PoC container creation failed' }
docker logs $pocContainerId
# 在当前 PowerShell 会话先配置 JAVA_HOME 为 JDK 21 的安装目录
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
$env:COORDINATION_POC_URL = 'jdbc:mysql://127.0.0.1:33316/coordination_poc'
mvn '-Dtest=CoordinationPocTest,CoordinationMySqlTest' test
docker stop $pocContainerId
```

未设置 `COORDINATION_POC_URL` 时数据库用例跳过；必须检查测试报告中的 skipped 数，而不能把跳过视为通过。`CoordinationStore` 只允许名为 `coordination_poc` 的数据库，但调用方仍负责保证它是隔离实例。实验使用合成凭据和数据，不应连接共享或生产数据库。

## 2026-11-10 证据核验补充

[当前分支交付、实际 CI 例数与验收边界](../testing/2026-11-10-multi-agent-closeout-and-parent-acceptance.md#issue16)已集中归档；本节不改写上文历史运行结果。按用户确认，issue 仅补一条短评论，保留原正文和状态。
