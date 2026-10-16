# 工单 07 首轮问题与证据边界

- `red-admission.log/xml`：尚无 `web.maintenance` 模块，CLI 边界测试按预期 RED。
  初次 Nginx 配置发现 map 哈希桶过小，调整为 128 后真实 HTTP 验证通过。
- `attempt01`：本机 MySQL 连接凭据将说明文字末尾句号误当成密码字符，连接被拒绝，
  未创建或修改业务库；改用已提供的正确本机凭据后继续。公开日志不包含密码。
- `attempt02/attempt03`：验收脚本误认为 Redis CONFIG GET 返回 bytes。
  已读取当前 redis-py 的 `parse_config_get` 源码，确认键和值均转换成 str，
  直接使用字符串路径。并非 Redis 服务或业务恢复缺陷。
- `attempt04`：两个故障分支首次完整通过，但引用清单与维护计时口径仍需加强。
- `attempt05`：增加 InnoDB 备份前置核验时误用默认 tuple cursor。
  改用既有 `runner.query` 的 DictCursor 接口；不改变数据库引擎或业务表。
- `before-review`：引用清单、MySQL 恢复核验和两个故障分支通过；静态审查后继续
  补充聊天补充的故障后重放及完整停写总计时。
- `attempt06-port-collision`：旧槽随机端口在样本准备前分配，稍后已被占用，Java
  明确启动失败。将网关/旧槽端口分配移至服务实际启动前，未终止占用进程、
  未更改产品端口，也未自动吞掉失败。新运行使用独立随机测试端口。
- `red-reserved-output.log`：输出路径取维护账本文件名时会覆盖账本，已通过公开 CLI
  重现并修复；账本和锁文件名现在在任何写入前拒绝，原配置及账本保持不变。

上述失败和最终证据分别保留。隔离库、备份、源码归档、旧 JAR 及私有运行日志保留
在忽略的 `.scratch/baseline-runtime/` 或 pytest 私有目录，公开材料仅含合成样本和摘要。

演练在 Windows / 本机 MySQL 8 / 独立 Redis、Chroma、Nginx、API/Worker 进程中执行。
模型、解释、检索外部 IO 为显式受控适配器；Chroma 的持久化/备份/重启真实验证，
向量值为受控 1024 维。对象为本地合成文件，真实 COS 不在验收范围。
故障注入是 API 进程终止，修复路径是止写后重启同一固定 Python 产物；不能据此
宣称任意代码、schema 或存储故障都可按相同步骤恢复。
Docker 未运行，未改 Docker/WSL 配置；未重跑 Linux 切换、托管 CI、真实供应商或临床。
未执行生产库升级/切流、push、历史标签创建或工单 08。
