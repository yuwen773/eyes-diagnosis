# R1.1 第二轮独立 Codex 审查

比较：`31f30ddc8c80a1e0556504058e6d34b145880653...747656f196ac1729b430b1bbd84f6fe9ae6fc302`。两个独立只读子代理分别执行 Standards 和 Spec；未推送、合并或部署。最终回归结果另见整改报告，不将代理判断替代运行证据。

## Standards

**PASS；新增确认 P0/P1/P2：0。**

ToolStepSink 同一 monitor 保护状态、审计及投递；closed/pending 防止重复终态。明确处理订阅取消，其余 EmitResult 通过 orThrow 暴露。屏障测试跨真实调用时序，符合 CODING_STANDARDS.md“接口即测试面”。代理独立执行真实 Reactor 回调重入 closePending 探针，审计与订阅均为 `[running,cancelled]`，迟到完成没有第二终态。

聊天存活门禁覆盖订阅、读取和发送复验，保留历史/后台独立生命周期。图片转换要求配置来源、归属和活跃登记行，无任意 URL 获取。NONE 映射、协议计数及 Vision 白名单展示均落在对应层。

后续租约领取、校验与续约改用数据库时间，与恢复扫描一致；原任务锁顺序、owner/token fencing、10秒TTL和原始断言保持。±6秒及快20秒竞争者测试覆盖真实调用时序。Graph计数32→36对应四项新增执行，无放宽跳过门禁。冻结AgentPage和已应用迁移无差异。

整体仍REQUEST_CHANGES：受控时差修复不能证明历史Docker约3秒静默的原因。续约调度仍使用宿主时钟，静态时差测试未证明动态钟跳或调度停顿无影响；这是调查边界，未确认新增回归。

## Spec

**REQUEST_CHANGES；新增代码复审未确认具体实现缺陷；七项原P2未发现仍存在的证据。**

逐项校验：工具状态终态原子认领；NONE/REWRITE/SUPPLEMENT分开；仅成功应用新事实清零repairs；医生只渲染授权冻结Vision明确字段并沿用材料版本/摘要；聊天删除封流而保留后台和历史；仅登记自有URL转key，不抓任意HTTPS。

WP-C最初缺少确定性根因。代理提出Java/DB实际时间差假设，主代理用测量偏差的±6秒测试在原续约断言处复现2/2FAIL；数据库时钟修复后定向4/4PASS。代理要求加强claim侧快时钟负例，已增加快20秒竞争者零provider调用、token不变、原运行成功断言；单独恢复旧领取比较即产生4次非法调用，负例FAIL。

修复符合共享数据库时间权威，未扩大租约、超时或放宽断言。但这些证据证明的是“时钟不一致可产生相同失败”，不是旧Docker现场唯一根因。旧现场无同次DB/host偏差、线程或锁等待记录，因此历史静默仍OPEN。不得把预期跳过或原生通过升级为历史因果证明或整体REVIEW_PASS。

Standards：0项确认，PASS。Spec：七项源码整改未确认遗留，WP-C历史因果未闭环，REQUEST_CHANGES。

## 最后测试增量复审

两代理另审 `747656f…2dc6820f`：Standards PASS、Spec测试增量PASS。独立路由、新建动作、刷新需新授权Blob均符合现有实现，上传/增量事实/取消/撤权/隔离/审批与回执断言保留，无超时改动。Spec指出只有backend截图路径改到target，safety两图仍写旧docs；已将两图复制到target归档并还原本轮生成差异，报告对应校准。整体仍REQUEST_CHANGES，历史WP-C原因未知。
