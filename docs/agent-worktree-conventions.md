# Agent 工作树约定

本文件被 `CLAUDE.md` 的 Navigation 引用，随仓库走，因此在每棵工作树里都可见。

## 目标行为

工作树会话里，每条 git 命令都在当前工作树根目录单独执行，一步一件事。

- 用 `git status`、`git add`、`git commit`、`git log`、`git diff` 这类单条普通命令，cwd 就是工作树。
- 要跨检出比较时，用 `git show <ref>:<path>` 读内容，不用 `git -C` 把命令指回主检出。
- 复合命令（`a && b`、`a; b`、管道里再跑 git、脚本读文件内容后跑 git）拆成多次调用，一次一条。

会话隔离守卫会拒绝「无法证明只作用于本工作树」的命令，包括：

- `git -C <共享检出> ...`、`git --git-dir=...`
- `cmd /c ...`、`powershell -Command ...` 这类把 shell 文本交给另一个解释器的包装
- 过于复杂、静态检查无法判定边界的复合 git 命令

遇到拒绝时按上面拆成普通单条命令重试，不要换解释器绕过。

## Windows 进程操作

MSYS/Git Bash 会改写以 `/` 开头的参数。杀进程用 `MSYS_NO_PATHCONV=1`：

```bash
MSYS_NO_PATHCONV=1 /c/Windows/System32/taskkill.exe /PID <pid> /F
```

`kill <pid>` 对 Windows 原生进程常常拿不到句柄；先 `netstat -ano | grep :<port>` 拿 PID，再按上面 `taskkill`。

## 退出与清理

- `ExitWorktree` 只有「拥有」该工作树（本会话创建）才会移除；`EnterWorktree({path})` 进入的既有工作树要用 `action: "keep"`，移除交给拥有者会话。
- 删分支前确认提交已在 `origin/master`：`git merge-base --is-ancestor <branch> origin/master`。未合并且确认要丢弃才用 `git branch -D`。
- 临时验证产物（临时数据库、`application-dev.yml` 副本、`target/e2e-*`、CDP 脚本）用完即删。

## 编码

`pom.xml` 已固定 `project.build.sourceEncoding` 与 surefire 的 `-Dfile.encoding=UTF-8`，
`mvn test` 的中文异常信息按 UTF-8 输出，无需每次手加参数。
MySQL 用 `--default-character-set=utf8mb4`。若 Bash 里读到的仍是乱码，是终端
代码页而非 JVM：用 `chcp 65001` 或把输出重定向到文件后用编辑器读。
