# 审批成功后的即时可见性

目标：原审批 PATCH 成功响应已发出时，独立请求必须读到已提交的新治理版本；
提交失败不得返回审批成功。人工验收继续搁置。

## 复现与定位

历史原始响应保留在 `../20261017T113839Z-save-preparation-e32923/`：
`reference-8-confirmed.json` 返回版本 1 / APPROVED，但随后的
`reference-governance-after.json` 返回版本 0 / PENDING。

新增 `algorithm/web/tests/test_knowledge_durability.py`，通过原应用 HTTP 接口，
在 ASGI 完整成功正文发送后、请求清理前发起独立列表查询。
使用文件 SQLite 和独立连接，使用原 `get_db` 依赖，只有数据库工厂和 Redis 边界受控。
该测试不经过代理，也不从数据库旁路读取结果。

复现命令（仓库根目录，`PYTHONPATH=algorithm`）：

```text
algorithm/.venv-baseline/Scripts/python.exe -m pytest algorithm/web/tests/test_knowledge_durability.py -q
```

修复前两次均为 `1 failed`，读到 `(0, PENDING, PRIVATE_USER, [])`，见
`red.log/red.xml` 与 `red-repeat.log/red-repeat.xml`。预期为
`(1, APPROVED, CURATED_PUBLIC, [myopia])`。

按排序检验三个假设：

1. 响应早于提交：预期把提交移至成功响应前后旧读消失。已证实。
2. 读事务复用旧快照：复现读取使用独立连接/请求，仍失败，不支持该解释。
3. 缓存或代理返回旧内容：直连 ASGI 仍失败，不支持该解释。

本机锁定 FastAPI 的 `routing.request_response` 先发送响应，再退出 request stack；
默认生成器依赖使用该 stack。原 `web.database.get_db` 在 yield 后提交，
审批路由仅 flush，因此出现可确定复现的未提交读取窗口。
这证明历史现象存在同一路径的时序缺陷；未采集历史请求事务时间线，
不据此声称已逐事件重建那次原始请求。

## 最小修复与边界

仅将 `govern_document` 的 `db.flush()` 改为显式 `db.commit()`，随后返回原 VO。
不改变全局依赖生命周期、接口契约、行锁、版本比较、角色/确认要求、资料正文、
临床复核、用户保存授权或安全校验规则。

新回归另验证提交抛错时返回 HTTP 500/code 50000、不返回审批成功，
独立查询仍为版本 0/PENDING；相同版本可重试成功，旧版本再次提交返回 409。
定向回归 `focused.xml`：21 passed、1 skipped；跳过项是已有真实 MySQL SKIP LOCKED 门禁。
修改的路由和摘要生成器 mypy 通过，见 `mypy.log`。

## 真实基础设施复验

`real_mysql_probe.py` 经原 `scripts/run_service.py api` 入口、真实 MySQL 和独立 Redis 运行，
使用新建并保留的 `eye_pyhandoff_*` 隔离库，具体名称见 `probe-manifest.json`。
这里的 20 份合成资料是受控测试夹具，不是实际参考资料审批或人工验收。

- 连续 20 次审批成功后，另一 HTTP 连接立即列表读回版本 1/APPROVED；无重试、等待或轮询。
- 旧版本重复审批返回 409。
- 强制停止已登记的 API 进程树，再从原入口启动，原 Redis 登录态下读回 20 份已持久化审批。
- 原参与者任务的 8 张业务表前后摘要一致，未新增正式诊断记录。
- 本次 LLM/embedding/COS 请求均为 0；未执行医生或患者决定。
- 两个 API 进程及独立 Redis 已核对身份并停止，见 `processes.json`。

结果见 `real-mysql-result.json`，绑定当前路由文件 SHA256；历史失败不覆盖。
全量 Web 证据单列 `../windows-web-governance/`，完成结果在台账另行追加。
摘要单列治理响应可见性，不再用“最终审批状态正确”替代即时可见性证据。

## 最终全量

原 `scripts/verify.py web` 退出码 0，829 passed、43 skipped、0 failed、
1 条既有警告，786.73 秒；详见 `windows-web.log` 和 `../windows-web-governance/web.xml`。
冻结迁移基线、依赖、退休扫描及入口类型检查均通过。
前端本次没有修改，沿用此前构建/类型检查与 49 项证据，未冒充本轮重跑。
本缺陷修复验证完成，人工及补充样本外发边界继续保留，整体验收仍 BLOCKED。
