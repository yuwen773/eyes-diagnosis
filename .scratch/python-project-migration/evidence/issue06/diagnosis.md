# 工单 06 验证故障与边界

- 首轮 Linux 全量：799 通过、2 失败、40 跳过。一个 API 子进程在 20 秒启动期限内未响应；另一个保存事务回滚/重试用例被生产 Snowflake 的 5ms 时钟回拨保护拒绝，检测到 402ms 回拨。两个文件在同一无 JVM 镜像复验 28 通过；最终 Linux 全量 801 通过、40 跳过。没有改动生产时钟保护或宿主时间，也没有增加重试来吞掉 ID 错误。只读监测 `linux-final-clock.json` 实际观察到此 WSL 虚拟机仍存在毫秒级周期回拨；最终通过不代表宿主时钟问题已修复。
- 真实 MySQL 的 SKIP LOCKED 用例原先通过 workflow 前缀查询加锁，实际同时锁住业务索引的 next-key/gap，阻塞另一个任务插入 continuation。`performance_schema.data_locks` 取证后，用例改为精确主键锁；保持“锁一个任务，另一个继续”的原验收含义，未改 Worker 锁实现。红绿日志分别保留。
- Linux 真实服务预期缺权重请求按原契约返回 50000 错误信封。Starlette 随后重新抛出错误，Uvicorn 关闭该连接；紧接着的只读请求复用此 socket，两次发生 ReadError。仅给这个明确预期失败的验收请求加 `Connection: close`，仍检查错误信封及无正式诊断记录。没有给业务写入加传输层自动重试，也没有改变旧错误契约。私有服务日志保留在独立运行卷。
- Compose 首轮重启后的读回持续 502。强制占用 API 的旧地址后可稳定复现：API 为 `172.24.0.5`，Nginx 仍请求旧 `172.24.0.6`，见 `proxy-address-red.txt`。改用 Docker DNS 动态解析后，相同地址变化场景验证登录、数据、任务、会话和原 Vue 浏览器通过，见 `compose-accepted/results.json`。
- protobuf 生成器原先依赖 `src/main/proto`。无该目录的 CPU 镜像验证失败；原样冻结 `contracts/diagnosis.proto` 后，仅通过 Python grpc_tools 生成成功，消息字段与编号不变，原 Java 文件保留。
- CPU 算法首轮 305 通过、1 失败、1 跳过、16 慢测未选择。低显存用例的旧辅助工厂没有使用注入探针，落到了真实 CUDA；仅将该测试改用已有 `_mem_get_info` 显式入口，严格检查 1024MB 的 `InsufficientVram` 及未写 receipt/OOF，未改训练实现。最终完整算法回归 306 通过、1 跳过、16 慢测未选择。慢测所在 watchdog 独立门禁另外记录；在容器复现时使用 `--init` 对齐 CI 主机的孤儿进程回收条件，不将 zombie PID 当作仍运行的孙进程。

## 宿主 Docker/WSL 事件

Docker Desktop 曾因无法访问旧 AF_UNIX socket 而不能启动。只备份并重建本用户的 Docker 运行时 socket 目录，没有重置镜像、卷或业务数据。备份保留在 `%LOCALAPPDATA%/Docker/run.ticket06-*` 和 `%LOCALAPPDATA%/docker-secrets-engine.ticket06-*`。Windows 无法移动的 socket 目录通过 Ubuntu 的文件系统入口备份；启动 Ubuntu 后出现 Docker WSL 集成代理错误。用户提出疑问后停止该环境修复路径，没有修改 Ubuntu 配置、WSL 集成设置或网络。Docker 引擎仍可运行本票 Linux 验收，代理报错未被宣称已解决。

工程与隔离真实 MySQL/Redis/Chroma 的结果独立于模型权重、真实 embedding/LLM/COS 和临床结果。旧工单 19 的 embedding HTTP 401 与 Java 大 ID 历史阻塞保持原状；本票不升级业务库、不生产切流、不 push、不开始 07/08。
