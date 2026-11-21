# Iris CSS / Tailwind 职责边界契约

| 项 | 值 |
|---|---|
| 状态 | **提案（Draft PR，待 owner 裁定）** — 生效前不具备约束力 |
| 基线 | `origin/ui` @ `b805377f`（2026-11-18 实测；**不是**本工作树的 `f42065e4`） |
| 依据 | `docs/architecture/codebase-archaeology-2026-11-17.md` §4.4 |
| 工具 | `web/scripts/audit/css-boundary-audit.mjs`（`cd web && npm run check:css-boundary`） |
| 范围 | `web/`（React 产品前端）。`frontend/`（Vue，已弃用）不在范围内 |

## 0. 结论

Iris 是 **Custom CSS-first + Tailwind v4 辅助**，这个格局是对的，不需要推倒重来。缺的不是设计语言，是"谁能覆盖谁"的规则。**在规则落地前，不新增 utility 用法**——因为未分层的手写声明优先于 `@layer utilities`，混用后的覆盖行为与直觉相反。

## 1. 实测事实（可复跑）

```bash
git archive origin/ui web/src | tar -x -C /tmp/iris-ui-baseline
node web/scripts/audit/css-boundary-audit.mjs /tmp/iris-ui-baseline/web/src
```

| 指标 | `origin/ui` @ `b805377f` | 本工作树 `f42065e4` |
|---|---|---|
| TS/TSX 文件 | 198 | 171 |
| CSS 文件 | 29 | 25 |
| 手写 CSS 行数 | 23,154 | 20,975 |
| className 字面量 | 1,872 | 1,851 |
| Tailwind utility 出现次数 | 8（去重 2） | 8（去重 2） |
| 同一 className 内 utility + 手写类混用 | **0** | **0** |
| `@layer` 块声明 | 0 | 0 |
| `!important` | 36 | 35 |

两点读法：

1. **2,179 行的差值就是"用过期工作树做审计"的代价。** 契约以 `origin/ui` 为准，工作树数据只作对照。
2. 去重后的两个"utility"是 `sr-only`×7 与 `caret-blink`×1。后者是本地动画名被启发式命中，**真实 Tailwind utility 只有 `sr-only`**。混用数为 0，说明层叠冲突目前是**结构性风险，不是已发生的故障**。

## 2. 三层职责

```
Iris Design Tokens（tokens.css：唯一语义真源，Light / Dark / Brand / Admin）
      ├── Tailwind v4 —— 布局、间距、响应式、简单状态
      └── Iris CSS   —— 语义组件、复杂视觉、品牌与光学动效
                ↓
        Iris Product UI（用户端 / 管理端 / 影像判读 / Agent 协作）
```

令牌真值永远是 `web/src/styles/tokens.css`；`DESIGN.md` 是目标规范，两者冲突以令牌为准。

## 3. 三条硬规则

| 规则 | 内容 | 违反的表现 |
|---|---|---|
| **R1 语义色只走令牌** | 颜色、圆角、阴影、发丝线只能来自 `tokens.css`；utility 侧只用 `@theme inline` 已桥接的 12 个语义名（`bg-surface`、`text-fg-2`、`border-line`、`text-risk-critical`…），不写裸 hex、不写 `bg-[#fff]` | 深色主题下不翻转；`.is-admin` 上下文取值失效 |
| **R2 utility 只管布局** | utility 负责 flex/grid/间距/响应式/显隐等**无品牌语义**的属性；跨页复用的视觉语义（按钮、卡片、台账、读数）必须进 `web/src/styles/*.css` 的组件类 | 同一视觉在 5 个页面各写一遍 utility，改一次要改 5 处 |
| **R3 不叠同属性** | 手写组件类上不是不能加 utility，而是**不能加同属性 utility**（`.iris-card{padding}` + `p-8`）。需要覆盖时，改组件类的变体，或在规则落地后把该组件迁进 `@layer components` | 写了 `p-8` 但页面纹丝不动，然后误以为 Tailwind 没生效 |

R3 是当前最容易被 Coding Agent 撞上的一条：它看起来"该生效"，实际被未分层声明压住。

## 4. 冲突三档（审计口径）

不要把所有不一致都说成"视觉 bug"。三档的证据与处置不同：

| 档位 | 判定 | 证据 | 处置 |
|---|---|---|---|
| **A · 已触发** | 页面实际渲染错误 | 双主题截图对比 + 计算样式 | 立即修，算缺陷 |
| **B · 潜在** | 同一 className 内 utility 与手写类属性重叠 | `npm run check:css-boundary` 的「混用明细」 | 禁止新增；改到契约落地后按 §5 迁移 |
| **C · 维护成本** | 无运行影响，只是难改 | 无 `@layer`、近乎无 utility、`.css` 体量 | 登记，不排期 |

当前 A 档 = 0，B 档 = 0，C 档 = 23,154 行。**这是审计结论，不是重构任务书。**

## 5. `@layer` 引入路径

禁止一次性把全部 CSS 包进 `@layer` —— 会整体改变已有覆盖关系，回归风险不可控。分阶段：

| 阶段 | 做什么 | 门禁 |
|---|---|---|
| 1 | 只把**新增**组件写进 `@layer components`；老 CSS 一行不动 | 新代码 `check:css-boundary` 混用数为 0 |
| 2 | 按**文件**迁移，一次一个文件（建议从 `news.css` / `records.css` 这类低耦合文件开始） | 该文件涉及路由的双主题截图对比无差异 |
| 3 | 才评估 `utilities > components` 的覆盖语义是否可依赖 | 阶段 2 全部完成 + 有自动化视觉回归 |

阶段 1 是唯一建议在本季度启动的部分。

## 6. 双主题与 `.is-admin`

桥接已存在于 `origin/ui:web/src/index.css:18/25`：

- `@custom-variant dark (&:where(.dark, .dark *))` —— 把 Tailwind 默认的 `prefers-color-scheme` 改绑到 `html.dark`（主题真源是 `theme-provider.tsx`，不是系统偏好）。
- `@theme inline { … }` —— 只桥接 12 个语义色。**必须 `inline`**：非 inline 的 `@theme` 会把根级值快照给 utility，`.is-admin` / `html.dark` 的上下文覆盖就失效。

由此产生两条约束：

1. 新增令牌若要被 utility 用到，必须同时加进 `@theme inline`，否则 `bg-<name>` 不存在；
2. 已桥接的变量随上下文换值，所以 `bg-surface` 在品牌层、管理端、暗色下会得到不同颜色——**这是对的**，不要用任意值把它写死。

## 7. 验收

| 检查 | 命令 | 门禁 |
|---|---|---|
| 混用扫描 | `cd web && npm run check:css-boundary` | 新代码引出的混用 = 0 |
| 类型/构建 | `npm run typecheck && npm run build` | 绿 |
| 双主题视觉 | 手动或截图脚本 | 迁移的文件两套主题都无差异 |

**已知缺口**：目前只有 `web/scripts/evidence/visual-completion.mjs` 一个证据脚本，没有自动化 CSS 回归基线。这属于"可重复的视觉验收"缺失，列为后续独立任务，不在本契约范围内承诺。

## 8. 非目标

- 不重构现有 23k 行 CSS；不为清理而清理。
- 不要求旧页面 Tailwind 化。
- 不动 Iris 2.1 冻结面（`iris-ui-v2.1-freeze-20261115` 及后续授权合并）。
- 不改 `frontend/`（Vue，已弃用，但仍是活 CI job）。

## 9. 待裁定

1. 契约生效方式：并入 `DESIGN.md`（目标规范处），还是保留为独立文档、由 `DESIGN.md` 引用？
2. 是否批准 §5 阶段 1（新组件进 `@layer components`）。
3. 视觉回归基线工具选型（Playwright 截图比对 / 其他），这决定阶段 2 能否自动化。
