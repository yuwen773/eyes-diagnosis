# 本次环境观测

用户已明确允许启动 Docker 并完成隔离验证；不再受上一轮“保持 Docker 停止”限制。

Docker 首次启动失败于旧 `Docker/run/dockerInference`，备份运行目录后又暴露旧 `docker-secrets-engine/engine.sock`。单文件 Windows 改名失败，`Docker/run` 的目录改名成功；Secrets Engine 目录经 Docker 自己的 WSL 发行版内的文件系统入口改名保全。随后将两处运行目录同时保全并重建，Linux 引擎成功就绪。没有恢复出厂设置、删除镜像/卷或改 Docker/WSL 配置。

保全位置（本机用户目录，未提交 socket 内容）：

- `%LOCALAPPDATA%/Docker/run.before-closeout-20261017-1246`
- `%LOCALAPPDATA%/Docker/run.before-closeout-20261017-1249`
- `%LOCALAPPDATA%/docker-secrets-engine.before-closeout-20261017-1246`
- `%LOCALAPPDATA%/docker-secrets-engine.before-closeout-20261017-1249`

当前无 JVM 镜像重新构建成功。首轮 30 秒只读时钟观测见 `clock.log`：581 个样本，最小 wall-clock 步长 −3,827,131,346ns，最大 wall/monotonic 步长差 3,877,283,713ns。Windows 对照见 `windows-clock.log`：597 个样本，最小步长为正 50,048,500ns；两种观测均未修改时钟。

Linux 当前 clocksource 为 `tsc`；Docker 启动后 Ubuntu 与 docker-desktop 均处于运行状态。只读检查发现 Ubuntu `systemd-timesyncd` active，journal 多次记录 Clock change，轮询间隔 32 秒，单次 status 记录 offset −2.962458s。与 WSL 回拨有关联，但没有执行停服对照，不能确认因果或宣称修复。

排查顺序：共享 WSL 时间同步回拨、验证子进程期限、项目恢复逻辑。原环境完整验证使用未经修改的生产时钟保护与测试断言；失败记录不覆盖。原环境全量结果为 808 通过、6 失败、43 跳过：5 项直接报 ID 回拨（142–2273ms），1 项 Worker 未领取到任务，不能仅凭关联将后者的原因提前定为回拨。

用户随后明确允许临时停止 Ubuntu `systemd-timesyncd`，结束恢复，不禁用服务或修改配置。停服后的独立 30 秒观测为 562 个样本，最小 wall-clock 步长为正 50,055,934ns，没有捕获回拨；仍有约 695ms 的正向步长差。这是单次对照观测，不是永久环境修复。`after-timesync-stop/` 保存同实现/同测试的完整对照运行，Web 814/43、基础设施三 gates 和承接 21 通过；`service-restoration.json` 实测记录恢复 active/enabled，结束后再次只读确认 active。用户要求不再继续 Linux 验收，后续不追加运行。

参考：[Microsoft/WSL issue 11790](https://github.com/microsoft/WSL/issues/11790) 有同类报告；它只用于形成假设，不代替本机观测或证明修复。
