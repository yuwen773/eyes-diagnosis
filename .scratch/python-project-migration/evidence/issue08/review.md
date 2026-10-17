# 工单 08 双轴审查

基点：`3eff16390721b4d8b5a36b6623d2bb0981b8a441`。
范围：本票暂存实现；既有 CLAUDE.md 修改和 frontend/.omc 删除不在提交中。
使用 `code-review` 技能的两名独立只读审查代理。

## Standards

首轮 1 项 P2：静态扫描漏掉 Dockerfile。补充 Dockerfile 与 *.Dockerfile、明确的
安装/执行命令规则和 CLI 反例。复审：0 项剩余问题；无文档规范违反或可操作代码异味。
最后单独复查 .dockerignore 和 Verify.Dockerfile 的当前指引复制；历史与秘密仍排除。

## Spec

首轮 1 项 P2：依赖扫描还遗漏当前文档命令与前端 package scripts。补充 README、
AGENTS、Python 交付指引、package.json scripts，以及 Python 旧环境访问；文档仅扫描
fenced/inline 命令，历史档案不进入当前指引。4 个新增反例先失败，修复后 11 项通过。
复审：0 项剩余问题。静态扫描的有限规则边界在当前文档明确保留。

静态复审通过不替代全量、真实基础设施或临床验收；实际结果独立登记机器汇总。

最终状态复核确认用户要求保持 Docker 停止，工单为 in-progress / PARTIAL，跨环境
判据仍未勾选。报告将资源争用表述为可能原因，并在机器汇总列入两轮 Windows
基础设施及首轮全量失败，不以单文件复验代替 Linux 全量通过。两项报告修正已落实。
