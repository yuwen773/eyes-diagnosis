# TASK-04：React 事件层与协作态验收

2026-11-11。结论：TASK-04 工程验收 PASS（确定性前端范围）；实时产品整体验收仍为 PARTIAL。Graph、真实模型、Redis、生产迁移和浏览器到真实后端未因此放行。

## 输入与隔离

- 工作树：`D:/Work/code/eye-diagnosis/.claude/worktrees/realtime-react-events`，分支 `codex/realtime-react-events`。
- Java 基线：`6572743169027bb1e7c27d7d969a26ed89d99cd1`；React 固定来源：`a0efaf46d6f8b53bea4a35d613fc806e2f6e9d47` 的完整 `web/` 和根 `DESIGN.md`。没有整分支合并、修改 Java 领域服务或迁移。
- 任务来源：实时多 Agent 实施计划 v1.1 的 TASK-04 / M3；允许从 TASK-03 分出 TASK-02 或 TASK-04，本轮选择独立推进 TASK-04。
- 后端契约来源：`codex/realtime-coordinator-events` 未提交候选的 CollaborationRunService、CollaborationEvents、CollaborationRunController 以及项目 JsonConfig；精确输入 SHA-256 见 [契约审计](realtime-react-events-20261111/source-contract.json)。未重跑或升级其此前 67 项后端证据。
- 候选尚未提交/推送。基线 HEAD 不含本次改动；代码与实际测试由 [结果清单](realtime-react-events-20261111/results.json) 的文件哈希绑定。没有查询远端当前状态。

结束时逐文件 SHA-256 和变更路径集合核对通过：原工作区 34 个既有文件、TASK-03 工作区 18 个既有文件内容均未改变。React 固定来源共引入 166 个文件（含根设计文档），只有已有 AgentPage 做本卡必要的作用域接线，其余来源文件保持原样。

## 实现与可观察行为

| 范围 | 验证结果 |
| --- | --- |
| Typed API / DTO v1 | 显式受理、快照、取消、SSE；保留 HTTP 分类；14 种事件和 12 个快照字段与 TASK-03 源码相符 |
| 实际 JSON 线格式 | 真实项目 JsonConfig + 实际 Java record、合成内容；证实 long 序号为字符串并在前端严格归一化；Instant 为字符串 |
| reducer | 授权过滤跳号、重复/乱序/旧事件、水位替换、心跳游标、角色状态、终态不可回退；不推定医生批准 |
| 恢复 | 断线从最后已应用游标续读；409/410 替换快照；不重新创建运行；未知 schema/关键事件修复一次后仍失败则停止 |
| 作用域与授权 | 身份/会话/run 隔离；旧快照/帧/回执不写入新选择；403 清空且忽略迟到帧；重连授权完成前不重新显示旧投影 |
| 持久取消 | 只 POST 当前选定 run，重复点击只发一次；ALREADY_TERMINAL 读实际终态；失败不合成 CANCELLED；断开与取消独立 |
| 正式页面 | 已有 /agent 提供协作 context；默认关闭，显式 runId 选择；切会话/新建会话清理选择；登出停止读取与取消 |
| 旧功能 | 从固定 SHA 引入的 193 项既有测试全部保留并通过；普通聊天流及附件/会话操作继续使用原模块 |

正式页面接入仅为数据/context 层；测试中的 context 探针不是患者可见 UI。未新增演示页或伪造协作对话；未改动 Vue。任务上传、可见时间线和状态面板继续交 TASK-05。仅从当前快照往后接收真实事实，不把快照拆成历史实时动画。

## 命令与结果

环境：PowerShell 7.6.9，Node 22.21.0，npm 10.9.4；Java 线格式导出使用指定 Corretto 21.0.7。原 package-lock 保持固定来源内容，使用 ASCII 用户路径下的现有 npm 缓存离线安装，未安装或升级额外依赖。

| 命令（web 目录，另注除外） | 实际结果 |
| --- | --- |
| `npm ci --offline --no-audit --no-fund --cache C:/Users/yuwen/AppData/Local/npm-cache` | 安装原锁文件依赖成功 |
| `npm test`（固定基线原测试） | 193/193 通过，0 failures，0 skipped |
| `npm test -- --reporter=json --outputFile=../docs/testing/realtime-react-events-20261111/vitest.json` | 最终 298/298 通过，0 failures，0 skipped；新增 105 项，原有 193 项 |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS，无新增禁用规则 |
| `npm run build` | PASS；保留大 chunk 警告，未通过调高阈值掩盖 |
| 根目录 `python scripts/check_collaboration_fixture.py --backend-root <TASK-03工作树> --output docs/testing/realtime-react-events-20261111/source-contract.json` | PASS，14 种事件、12 个快照字段 |
| 根目录 `python scripts/check_design_doc.py`、`python scripts/check_steering_docs.py`、`python scripts/check_probability_scale.py` | PASS |
| `git diff --check` | PASS |

首次离线安装使用系统默认 npm 缓存时失败（ENOTCACHED）；切换到已存在的正确用户缓存后成功。开发中的页面测试曾暴露测试 mock 重置后未重新设置会话列表返回值、按钮可访问名错误；均已修复并保留实际断言，没有禁用用例。手写数字夹具无法覆盖项目 long 字符串序列化，已补真实 mapper 导出及边界测试。

完整用例名、各文件计数、源码哈希及输入保护结果见结果清单。原始 Vitest 报告运行后归档到本地 `target/task04-vitest.json`；构建输出为 `target/task04-build.log`，这些为本地生成产物。新增根 CI web job 包含 typecheck/test/build/lint；本轮未提交或触发 hosted CI。

线格式复现：先在 TASK-03 准备编译产物/依赖 classpath，用该 classpath 与 JDK 21 编译 `scripts/fixtures/CollaborationWireFixture.java` 到临时输出目录，然后以 `collaboration.v1.json`、输出路径为两个参数运行。导出器直接实例化实际 JsonConfig 与 CollaborationRunService record，无数据库、会话服务器或模型请求；不能据此宣称 HTTP/MySQL/模型联验通过。

引入 React 时同步两份项目指引的正式前端/设计入口；机械检查还发现原基线指引落后于既有 V17 与 patient-draft-test 控制器，已同步为实际源码值。没有修改迁移内容或写入本机数据库凭证。TASK-03 合入后须由整合卡再次同步其 V18/API 指引，不能将本分支 V17 描述覆盖回 TASK-03 的 V18。

## 未验证项与下一步

| 项目 | 状态 |
| --- | --- |
| 浏览器与真实 TASK-03 HTTP/SSE、MySQL、Redis 会话撤回联调 | NOT_RUN；本轮 HTTP/SSE 测试使用合成响应和真实 fetch-event-source 解析器，Hook/页面测试使用确定性 API 替身 |
| Graph 等价性、租约接管、节点恢复 | NOT_RUN，TASK-02 |
| 真实提供方、引用/反馈质量、正常医学输入与 OOD | NOT_RUN，TASK-06；本轮没有真实模型或临床数据 |
| TASK-05 时间线/影像面板、双主题/移动/a11y/Playwright | NOT_RUN；本卡未改视觉或声称完整工作台可演示 |
| 医生发布/患者保存、真实链路 E2E | NOT_RUN，TASK-07 与最终整合 |
| 新 CI job hosted 运行、生产构建发布、性能/成本/SLO | NOT_RUN |
| 数据库历史冲突与生产迁移 | 保持既有阻塞；前端引入未解决 Java/master 的迁移分歧 |

下一卡可进入 TASK-05，使用本卡 context/reducer/API；TASK-02 仍可独立进行。TASK-05 开始前需在自己的整合范围引入 TASK-03 后端候选并保持输入哈希可审计，真实联调不能被本轮夹具结果替代。

回滚：移除前端构建开关并重新构建，客户端卸载只断开订阅；如需终止活动任务，另行显式持久取消。后端事实、审核状态及历史数据不受本卡回滚更改。M0/M1 及实时产品整体验收保持 PARTIAL。
