# Iris 夜间发版攻坚台账 · 2026-11-19 → 2026-11-20 08:00

> 唯一进度台账。每轮循环先读本文件 + `git status` + PR/CI，再从「下一步」继续。
> 恢复锚点：本文件 + 最新已验证提交。

## 0. 基线与工作树

- 开发主线：`origin/ui` = `361be4be`（PR #119 RC 集成）。
- 发布目标：`origin/master` = `a0efaf46`；`master` 是 `ui` 的**严格祖先**（可 fast-forward）。
- 本台账所在工作树：`.worktrees/ui-latest`，分支 `release/v1.1.0-rc.2`（从 `361be4be` 切出）。
- 其它工作树：主检出 `feat/r3-agent-correctness`（含 Docker 资源 WIP，**不动**）；
  `.worktrees/verify-levels`（#120 验证分级 WIP，**不动**）。
- 本地栈：后端 8081（ui-latest，profile 含 local，真实 DashScope `DASHSCOPE_API_KEY` 存在）、
  vite 5173、Chroma 8000、Redis 6380、MySQL 3306（`diagnosis`，已到 V29）。
- 种子账号：`acceptance-patient-8til3oiuo` id `9223372036854775801`；cookie `/tmp/eye-cookie.txt`。
- 证据目录（不入库）：`C:/Users/yuwen/AppData/Local/Temp/eye-overnight-2026-11-19/`。

## 1. 当前任务

**P0 · 视觉分析 imageId 归属误报「无权分析他人图片」** — 复现 + 根因 + 修复 + 定向测试。

### 已确认事实

- 真实链路已跑通一次（22:38，threadId `10f5f8ef…`）：`TOOL_REQUEST` 参数
  `{"imageId":"agent-chat/9223372036854775801/11018f8c-…jpg"}` → 视觉模型返回合法结构化 JSON →
  tool-result `succeeded` → SSE 流式回答 → 干净结束。证据 `sse-run1.txt`。
- 失败为**间歇性**：22:09 session `d7233829…` 同一 seed 用户，
  `EyeImageAnalyzerTool.resolveOwnedObjectKey:158` 抛 `无权分析他人图片`（NO_AUTH = 前缀不匹配），
  `ToolExecutionException` 被 `DefaultToolExecutionExceptionProcessor(true)` 转成工具错误。
- 根因：**依赖模型逐字复述长对象键**。模型有时把 `agent-chat/{uid}/{file}.jpg` 截断成文件名
  或改成视图 URL，前缀校验即失败。上传返回值是视图 URL `/api/agent/image/view/{file}.jpg`，
  与注入给模型的内部对象键**形状不一致**。

### 修复方案（安全不减弱）

在 `EyeImageAnalyzerTool.resolveOwnedObjectKey` 归一化**服务端签发过的三种形状**到本用户命名空间：
1. 完整对象键 `agent-chat/{uid}/{file}`（显式越权前缀仍拒绝）；
2. 视图 URL `/api/agent/image/view/{file}`；
3. 裸文件名 `{file}`。
归一化后**仍执行**原有 `agent-chat/{uid}/` 前缀 + `t_upload_task` 归属 + 活跃状态校验。外部 URL、
跨用户、路径穿越、非法字符一律拒绝。

## 2. 待办（按优先级）

- [ ] P0 视觉 imageId 归一化修复 + 单测（进行中）
- [ ] P0 用真实模型复跑确认修复后仍成功，并补负例（非法/跨用户/已删除/外链）
- [ ] G-3 真实 DashScope 场景：G3-1 流式文本 / G3-2 RAG / G3-3 工具失败 / G3-4 中断取消 /
      G3-5 附件信任边界 / G3-6 视觉成功 / G3-7 COS 上传（视凭据）
- [ ] G-5 浏览器视觉验收（390/768/1440，深浅双主题，登录/Agent/判读/管理端/错误态）
- [ ] V17→V29 隔离库迁移 + 备份恢复演练
- [ ] ui→master 发布候选 PR + 完整 GitHub CI
- [ ] 版本号建议（v1.1.0 vs v2.0.0）+ Release Notes 草案（需 owner 确认）

## 3. 失败 / 阻塞

- 暂无（继续推进）。

## 4. 最近一次命令与结果

- `POST /api/agent/chat/stream`（threadId `10f5f8ef…`）→ 退出码 0，SSE 12083 字节，工具成功。PASS。
- 日志取证：seed 用户 22:09 session `d7233829…` 有 1 次 NO_AUTH 失败。CONFIRMED。

## 5. PR / CI

- 尚无 `ui→master` PR。待候选稳定后创建。

## 6. 判定

- 当前：**CONDITIONAL**（P0 修复在途；G-3 部分已证（视觉成功）、G-5 与迁移未做）。
