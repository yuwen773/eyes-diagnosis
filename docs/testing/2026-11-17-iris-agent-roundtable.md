# Iris Agent Roundtable 3.0 本地交付与验收

## 基线核对

进入任务时，当前工作树的 detached HEAD 为 `a0efaf46`，没有协作工作台。PR [#87](https://github.com/yuwen773/eyes-diagnosis/pull/87) 仍是未合并的 Draft，实际集成头为 `6ba65478b8c88d2ef1a019044bbd2232e1842961`。在同一工作树上从该提交创建 `codex/iris-roundtable-3`，以便继承 #87 已验证的前后端协作协议。冻结 tag 和 `ui` 分支引用保持原位。

工作环境能读取用户确认的画面、Iris Digital Personas v1.0 角色板，以及 `iris.html`、`roundtable.css`、`draft.html`、`draft.css`、`iris-digital-personas.png`。四个 WebP 从角色板直接导出。协作界面复用 #87 的共享 `ProductHeader`，并从已合并的 [#88](https://github.com/yuwen773/eyes-diagnosis/pull/88) 采纳当前 Optical Iris 字标与主题位图。`origin/ui` 的首页特效、管理端与其他变更不属于这次工作台集成。

| 功能 | #87 实现 | 存在问题 | 本轮处理 |
| --- | --- | --- | --- |
| 路由与顶栏 | `/agent/collaboration` 经开关、会话及深链鉴权，复用产品顶栏 | 标题占高，启用第四个入口后 1024px 顶栏控件相撞 | 压缩标题和任务栏，窄桌面使用共享导航抽屉 |
| 团队 | 四角色图标平铺，状态来自快照 | 缺少已确认的肖像、角色详情与记录定位 | 导出角色肖像，建立成员栏、状态及详情弹层 |
| 会话 | 按时间顺序渲染通用记录，使用游标与事件序号 | 阶段、交接、证据、反馈、终态的视觉区分不足 | 独立事件卡，定位关联记录，保持两轮 Atlas 事实 |
| 资料与复核 | 读取服务端授权影像，患者批准后走独立的解释与保存接口 | 影像、证据和人工复核没有独立视图 | 共享三标签检查器，缩放、可用时全屏，窄屏抽屉 |
| 恢复 | 快照鉴权，同一连接作用域内 SSE 游标恢复 | 刷新快照丢弃本页已收到的事实，撤权后代理浏览器曾继续显示已连接 | 同一授权投影下保留已确认事实，授权改变清除。已提交响应的撤权流正常结束并重新鉴权 |
| 响应式与测试 | 固定布局及 29 个合成协作浏览器用例，另有真实 Java loopback | 缺 360、1024、1280 及角色详情、补证回流的验收证据 | 扩展视口、交互断言、可访问性检查和双主题截图 |

## 事件与权限映射

- `agent.started`、`agent.completed` 和 `snapshot.roles` 驱动当前成员状态。历史事件按既有 `(runId, sequence)` 去重，Atlas 再次开始执行时保留已有成果。
- `agent.summary` 使用后端提供的受控事实标记和计数。影像质量事件关联本次任务影像。影像实际字节仍由 `reviewApi.image` 重新鉴权并以 Blob 展示。
- `agent.handoff` 只在获准的临床投影展示，按已知信封类型显示用途。`agent.readable` 显示校验记录到达状态，临床材料正文沿用医生复核入口。
- `evidence.verified` 通过事件标识定位核验记录，只展示实际版本。患者批准后的依据、文档版本及保存授权继续走 `PatientResultPanel` 和已有接口。
- `agent.feedback.requested` 显示 Vera 请求补证或修订。后续角色真实开始执行时，阶段才从等待变为处理中。复核标签按事件标识定位反馈，医生审核状态独立取自快照。
- `run.completed` 或服务器的 `SUCCEEDED` 快照产生完成卡。失败、受限、取消及连接中断各使用自己的状态。没有引入 `agent.evidence.updated`、`run.stage.updated` 等未实现的事件。

## 授权范围和未覆盖能力

- 现有快照只返回当前状态及尾部游标。断线用既有游标续读，同页授权范围相同时保留已观察到的事实。冷刷新无法恢复快照水位以前的详细记录，界面按当前状态恢复。
- 运行中的患者投影只提供受控阶段事实，不包含内部交接、临床草稿、引用正文或关联来源标识。材料批准后走既有读接口。团队自由提问、临床报告下载、跨任务成员参与历史，以及无关联标识的证据定位没有新入口。终态授权变化由返回页面或主动刷新触发重新核对，现有协议未提供终态撤权推送。
- 合成事件浏览器测试与真实 Java HTTP/SSE/MySQL 联调分开记录。隔离后端的会话引导、存储、推理和模型是合成测试接缝，真实模型提供方、临床效果和生产环境不在这套结果之内。

## 复跑与截图

工具使用 Node 22.21.0、Chrome 157.0.8103.79、JDK 21 及隔离 MySQL 8.0.36。启用协作的 Vite 开发进程只在本机使用 `VITE_COLLABORATION_ENABLED=true` 和 `COLLABORATION_TEST_BACKEND`；默认关闭另用常规构建验证。

- `npm run test:collaboration` 使用 `E2E_BASE_URL` 指向启用协作的 Vite 服务。可设置 `ROUNDTABLE_EVIDENCE_DIR` 保存截图，否则写入 `web/test-results/roundtable-evidence`。
- 文件名 `running-*`、`supplement-*`、`completed-*`、`member-*`、`mobile-inspector-*`、`connection-interrupted-*` 和 `execution-failed-*` 标识页面状态、主题和视口。
- 真实后端流程见 [现有浏览器验收说明](../../web/e2e/README.md)，运行 `collaboration-backend.spec.ts` 和 `collaboration-safety.spec.ts` 时使用真实隔离 Java 服务，不拦截 SSE。

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 类型、Lint、生产构建 | `npm run typecheck`、`npm run lint`、`npm run build` | PASS |
| React 单元与组件 | `npm test -- --maxWorkers=4` | 638/638，66 文件 |
| 协作浏览器，合成 API 与事件 | `npm run test:collaboration -- --workers=3 --fully-parallel` | 43/43。另对浅色及深色补证场景各复跑一次，验证断线前后的历史阅读位置 |
| Java HTTP/SSE/MySQL 浏览器联调 | `playwright test e2e/collaboration-backend.spec.ts e2e/collaboration-safety.spec.ts --workers=1` | 5/5。覆盖真实增量接收、刷新、取消、撤权、Graph 与 Coordinator 权限链 |
| 协作后端专项 | `mvn -o -B -Dtest=CollaborationRunTest test` | 33/33，隔离库，0 跳过 |
| 默认关闭与普通问答 | `playwright test e2e/collaboration-default-off.spec.ts`，连接默认关闭的生产预览 | 1/1 |
| 协议与 CI 辅助门禁 | `python scripts/check_collaboration_fixture.py --backend-root . --output target/roundtable-collaboration-contract.json`、`npm run check:e2e-fixme`、`npm run check:gate-tests` | 16 类事件、12 个快照字段，fixme 0/0，门禁 6/6 |

双主题视口包括 360、390、768、820、900、1024、1280、1440 和 1920px。桌面三栏承接设计参考。1024px 及更窄的平板把专业资料收进共享资料抽屉，手机使用横排成员入口和会话。验收包含文字与控件对比度、无横向溢出、键盘焦点、减少动效、图片原比例、缩放和浏览器支持时的全屏。生产构建仍提示既有管理端编辑页 chunk 超过 500 kB。
