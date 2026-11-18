# Agent 工作树约定

本文件被 `CLAUDE.md` 的 Navigation 引用，随仓库走，因此在每棵工作树里都可见。

## 目标行为

工作树会话里，每条 git 命令都在当前工作树根目录单独执行，一步一件事。

- 用 `git status`、`git add`、`git commit`、`git log`、`git diff` 这类单条普通命令，cwd 就是工作树。
- 要跨检出比较时，用 `git show <ref>:<path>` 读内容，不用 `git -C` 把命令指回主检出。
- 复合命令（`a && b`、`a; b`、管道里再跑 git、脚本读文件内容后跑 git）拆成多次调用，一次一条。

部分会话的隔离守卫会拒绝「无法证明只作用于本工作树」的命令，包括：

- `git -C <共享检出> ...`、`git --git-dir=...`
- `cmd /c ...`、`powershell -Command ...` 这类把 shell 文本交给另一个解释器的包装
- 过于复杂、静态检查无法判定边界的复合 git 命令

遇到拒绝时按上面拆成普通单条命令重试，不要换解释器绕过。
守卫是否启用随会话配置而定：2026-11-18 的 worktree 会话里 `git -C` 与 `powershell` 可直接运行，
不要把上一条当成「一定被拒」的绝对事实。

## Windows 进程操作

MSYS/Git Bash 会改写以 `/` 开头的参数。杀进程用 `MSYS_NO_PATHCONV=1`：

```bash
MSYS_NO_PATHCONV=1 /c/Windows/System32/taskkill.exe /PID <pid> /F
```

`kill <pid>` 对 Windows 原生进程常常拿不到句柄；先 `netstat -ano | grep :<port>` 拿 PID，再按上面 `taskkill`。

## 退出与清理

- `ExitWorktree` 只有「拥有」该工作树（本会话创建）才会移除；`EnterWorktree({path})` 进入的既有工作树要用 `action: "keep"`，移除交给拥有者会话。
- 删分支前确认提交已在 `origin/ui` 或 `origin/master`（`git merge-base --is-ancestor <branch> origin/ui`；`scripts/worktree-hygiene.sh branches` 会批量做这个检查）。未合并且确认要丢弃才用 `git branch -D`。
- 临时验证产物（临时数据库、`application-dev.yml` 副本、`target/e2e-*`、CDP 脚本）用完即删。

## 收尾：工作树与服务（2026-11-18 起）

2026-11-18 一次盘点清出 28 棵工作树、约 18 GB，其中 8 棵是 7–8 月就没人动的。
根因不是不会删，而是「收尾」从来没有固定动作。现在收尾只跑这四条：

```bash
scripts/worktree-hygiene.sh report              # 只读：每棵树的状态与建议
scripts/dev-servers.sh list                     # 只读：开发端口上还有谁在监听
scripts/worktree-hygiene.sh reap --apply        # 删「干净 + 提交在远端」的树
scripts/dev-servers.sh stop --all               # 停全部开发端口
```

有未提交改动的树不硬删，先归档再删：

```bash
scripts/worktree-hygiene.sh reap --archive-dirty --apply
scripts/worktree-hygiene.sh reap --archive-dirty --older-than 7 --apply   # 只动 7 天没更新的
scripts/worktree-hygiene.sh branches --apply                              # 已并入 ui/master 的本地分支
```

规则：

- 归档落在 `.worktrees/_archive/<日期>/`：`<树名>.patch`（已跟踪改动）、`<树名>-untracked.tar.gz`（未跟踪文件）、`<树名>.meta.txt`（HEAD/分支/status）。该目录已被 `.gitignore` 忽略。
- 想长期保留的树，把分支名或绝对路径写进 `.worktrees/_keep.txt`（一行一个）；`reap` 与 `branches` 永不碰。
- `--archive-dirty` / `--drop-unique` 默认只动 HEAD 超过 3 天的树，避免删掉别的会话正在改的树；`--older-than N` 可调。
- 永不自动删除：主检出、当前工作树、挂着开放 PR 的工作树、`master` / `ui` 分支。
- 基础设施端口（MySQL 3306/3307、Redis 6379/6380、Chroma 8000）不在 `--all` 范围内，要停必须显式写端口号。
- 删目录报 `Device or resource busy`：有进程 cwd 停在里面。MSYS 进程看 `/proc/*/cwd`；Windows 进程用 PEB 读 cwd。先确认是不是别的会话，别硬删。


## 编码

`pom.xml` 已固定 `project.build.sourceEncoding` 与 surefire 的 `-Dfile.encoding=UTF-8`，
`mvn test` 的中文异常信息按 UTF-8 输出，无需每次手加参数。
MySQL 用 `--default-character-set=utf8mb4`。若 Bash 里读到的仍是乱码，是终端
代码页而非 JVM：用 `chcp 65001` 或把输出重定向到文件后用编辑器读。

## 连续开发基线（Continuous Development Baseline）

> 2026-11-13 起的永久规则，适用于所有 Coding Agent（Claude Code / Codex）。
> 背景：#74 曾误从 #69 创建而漏掉兄弟分支 #73 的图标治理，返工集成一次。

### 1. 创建分支 / worktree 前先做基线检查

不得默认以 `master` 或 `ui` 作为开发起点。必须先读当前项目「最近完成、
经用户确认保留」的 PR 链（`gh pr list` + 交接文档 + 记忆），确定最新候选
分支与完整 SHA；存在多个未合并候选 PR 时先定依赖顺序，不得擅自选旧分支。

### 2. 新任务继承最新候选

下一轮依赖同一前端成果的任务，必须从上一轮的 HEAD 创建分支。创建后必须
实际跑 Git ancestry 检查，不能只写"基于上一轮"：

```bash
git merge-base --is-ancestor <parent-sha> <new-branch> && echo OK
```

### 3. Worktree 只负责隔离

允许新建或复用 worktree，但它不是独立产品版本。新 worktree 必须从指定的
最新候选 HEAD 创建（`git worktree add <path> -b <branch> <sha>`），
不能隐式继承 `master`。

### 4. 连续开发用 stacked PR

上一轮已验收候选 → 本轮 PR → 下一轮 PR；每个 PR 的 base 指向父候选分支。
只有用户批准的并行工作包才允许从共同基线分叉，且必须有明确集成步骤。

### 5. 强制交付报告

每次交付必须报告以下各项，缺一不算"完整交付"：

- Parent PR / Parent SHA
- 本轮 Branch / HEAD SHA
- 本轮相对 Parent 新增的提交数
- Git ancestry 检查结果
- 真实变更文件数（`git diff --name-only <parent>..HEAD`）
- 是否继承上一轮全部成果
- 是否存在被恢复的旧代码、旧图标、旧设计令牌
- 测试结果与未解决冲突

### 6. 禁止行为

- 禁止无理由从 master/ui 重开任务
- 禁止遗漏上一轮已验收但未合并的功能
- 禁止以 CI 全绿代替提交继承检查
- 禁止在未确认依赖的情况下修改 PR base
- 禁止未经批准自动合并或部署
- 禁止为了修复分支关系而重复开发整套已有功能
