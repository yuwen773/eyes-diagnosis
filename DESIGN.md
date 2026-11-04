# 眼瞳 Iris · 医疗编辑风（Clinical Editorial）设计系统

> 本文件是前端重构的**唯一设计真源（Single Source of Truth）**。所有页面、组件、令牌、文案气质以本文件为准。
> 方向：用户于 2026-07-28 在四轮预览后选定 **A · 医疗编辑风**。
> 硬约束：后端 API 契约已冻结（Architecture Frozen），前端重构只换皮/换结构，**不改任何数据流与端点**。
> 速查版规则同时写在项目根 `CLAUDE.md` / `AGENTS.md` 的 Design Rules 段；两者冲突时以本文件为准。

---

## 0. 一句话主张

**医疗 AI 的信任来自克制，不来自好看。** 颜色只做"语义"（动作、严重度），不做装饰；质感来自字体层级、留白、等宽数据的精密感，来自把"负责任 AI"做成一等公民。

这不是消费 App，是**会被医生看、被评委打分的临床级 AI 产品**。它应该读起来像一份可信的诊断报告，而不是一个花哨的健康玩具。

---

## 1. 设计原则（不可妥协）

1. **克制 = 信任（Restraint is trust）**
   界面里绝大多数是中性的瓷白/墨色。彩色只出现在三类地方：主强调（行动）、严重度语义、负责任 AI 标记。永远不用彩色做纯装饰、不做大面积色块、不做渐变背景。

2. **严重度语义色与品牌强调色解耦（Severity ≠ Brand）**
   品牌主色是青绿，但"低/中/高风险"用独立的语义色（绿/琥珀/红）。品牌色将来怎么改，严重度语义都不受影响。这是医疗产品的红线。

3. **等宽字体承载一切数字（Data is monospace）**
   置信度、病灶计数、分期、指标、时间戳等**所有量化信息一律等宽字体**，像仪器读数。这是医疗/评审场景最吃的"精密感"。

4. **负责任 AI 是一等公民（Responsible AI is first-class）**
   弃检提示、人工复核、模型溯源、医疗免责四个组件不是边缘小字，而是有明确视觉地位的设计元素——评审的加分项，必须被看见。

5. **衬线给权威，无衬线给功能（Serif authority, sans utility）**
   标题用衬线（Georgia）给权威与温度；正文、导航、按钮、标签用无衬线（系统栈）给效率。

6. **发丝线优先于卡片阴影（Hairlines over heavy cards）**
   用细分隔线和留白组织信息，少用厚重卡片与大阴影。需要层级时才用极轻的卡片/极淡阴影。

---

## 2. 色彩令牌（锁定值）

### 2.1 品牌 / 强调
| 令牌 | 值 | 用途 |
|---|---|---|
| `--iris-accent` | `#1b7f6b` | 主强调：主 CTA、品牌点、链接强调、选中态。全站唯一彩色品牌色 |
| `--iris-accent-strong` | `#155f51` | 强调的 hover / 按下态 |
| `--iris-accent-soft` | `#dcefe8` | 强调的浅色洗底（徽章、选中底、图高亮） |
| `--iris-on-accent` | `#ffffff` | 强调色上的文字 |

### 2.2 表面 / 背景（暖瓷系，非纯白）
| 令牌 | 值 | 用途 |
|---|---|---|
| `--iris-bg` | `#f6f4ef` | 页面主背景（暖瓷白，情绪基底） |
| `--iris-surface` | `#ffffff` | 卡片/面板表面 |
| `--iris-surface-2` | `#fbfaf6` | 次级抬升表面、嵌入式容器 |
| `--iris-line` | `#e6e2d8` | 发丝分隔线、卡片描边 |
| `--iris-line-strong` | `#d9d4c6` | 强调分隔线 |

### 2.3 墨色 / 文字（暖近黑，不用纯黑）
| 令牌 | 值 | 用途 |
|---|---|---|
| `--iris-ink` | `#16140f` | 主文字、标题 |
| `--iris-ink-2` | `#6f6a5e` | 次要正文 |
| `--iris-ink-3` | `#9a9587` | 三级文字、注释、元数据 |

### 2.4 严重度语义色（与品牌解耦，独立维护）
| 令牌 | 值 | 语义 |
|---|---|---|
| `--iris-sev-low` | `#2f9e6e` | 低风险 / 正常 |
| `--iris-sev-low-soft` | `#dff0e7` | 低风险浅底 |
| `--iris-sev-moderate` | `#b37708` | 中度风险 / 关注 |
| `--iris-sev-moderate-soft` | `#f3e6c8` | 中度浅底 |
| `--iris-sev-high` | `#c0392b` | 高风险 / 紧急 |
| `--iris-sev-high-soft` | `#f6dcd8` | 高风险浅底 |

### 2.5 功能态（克制，沿用常规但调暖）
| 令牌 | 值 | 用途 |
|---|---|---|
| `--iris-error` | `#b53333` | 错误（深暖红，不惊吓） |
| `--iris-focus` | `#1b7f6b` | 焦点环（用品牌青绿，替代冷蓝） |
| `--iris-info` | `#4a6b8a` | 中性信息（低饱和青灰，少用） |

### 2.6 禁区
- **禁止**任何紫蓝渐变、冷蓝主色、纯黑 `#000`、纯白页面背景。
- **禁止**把严重度色与品牌色混用。
- **禁止**新增彩色——彩色只能来自上面锁定的令牌。

---

## 3. 字体系统

| 角色 | 字体栈 | 说明 |
|---|---|---|
| 标题 Display/Heading | `Georgia, "Times New Roman", "Songti SC", "SimSun", serif` | 权威与温度；weight 500–600，单行高 1.10–1.30 |
| 正文 / UI | `system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif` | 功能文本、导航、按钮、标签 |
| 数据 / 数字 | `"JetBrains Mono", "SF Mono", "Consolas", monospace` | **一切量化信息**；可等宽对齐 |

### 层级（基准 16px）
| 角色 | 字号 | 字重 | 行高 | 备注 |
|---|---|---|---|---|
| Hero / 大标题 | 40–56px | 600 | 1.10 | Georgia |
| 区块标题 | 28–32px | 600 | 1.20 | Georgia |
| 卡片/小节标题 | 18–22px | 600 | 1.25 | Georgia |
| 正文 | 15–16px | 400–500 | 1.60 | sans |
| 辅助/说明 | 13–14px | 400 | 1.55 | sans, ink-2 |
| 标签 / 徽章 | 12px | 500–600 | 1.3 | sans, 可 0.5px 字距 |
| Overline / 眉线 | 11–11.5px | 600 | — | mono, letter-spacing 1–2px, 大写 |
| 数据 / 指标 | 24–30px | 500–600 | 1.1 | mono, ink |
| 时间戳/代码 | 12–13px | 400–500 | 1.5 | mono |

原则：
- 衬线只用 500–600，**不用 700+ 粗衬线**。
- 正文行高 ≥ 1.55，偏书版阅读感。
- 数字统一等宽，保证指标列垂直对齐。

---

## 4. 圆角 / 阴影 / 深度

### 圆角（统一、克制）
| 令牌 | 值 | 用途 |
|---|---|---|
| `--iris-radius-sm` | `6px` | 小按钮、标签、徽章 |
| `--iris-radius` | `8px` | 标准按钮、卡片、输入框 |
| `--iris-radius-lg` | `12px` | 主按钮、较大容器、模态 |

### 阴影 / 深度（发丝线 + 极淡阴影，拒绝厚重）
| 层级 | 实现 | 用途 |
|---|---|---|
| 0 Flat | 无 | 页面背景 |
| 1 Hairline | `1px solid var(--iris-line)` | 卡片、分隔、面板 |
| 2 Ring | `0 0 0 1px var(--iris-line-strong)` | 交互卡 hover / 选中 |
| 3 Lift | `0 4px 20px rgba(22,20,15,0.06)` | 仅用于真正需要抬升的浮层、下拉 |
| Focus | `0 0 0 3px var(--iris-accent-soft)` + `1px solid var(--iris-focus)` | 键盘/焦点可见性 |

**原则**：深度主要来自发丝线与留白节奏；阴影极淡且用暖黑（rgba 基于 ink），不用冷灰大投影。

---

## 5. 组件约定

### 按钮
- **Primary**：底 `--iris-accent`、字 `--iris-on-accent`、圆角 8–12px。全站唯一彩色 CTA。
- **Secondary**：底 `--iris-surface`、描边 `--iris-line-strong`、字 `--iris-ink`。
- **Tertiary / 文字按钮**：字 `--iris-accent`，无底。
- Hover：背景滑向 `--iris-accent-strong`（primary）或出现 ring（secondary）。

### 卡片 / 容器
- 底 `--iris-surface`，描边 `1px var(--iris-line)`，圆角 8–12px。
- 需要分隔优先用发丝线 + 留白，而非叠卡片。
- 抬升阴影仅在浮层使用（Lift）。

### 数据展示
- 指标数值用 mono 大号；标签用 ink-3 小字。
- 图表主色用 `--iris-accent` 与中性墨色；**严重度/风险图表用语义色**，不与品牌混。

### 严重度徽章
- 用对应 `--iris-sev-*` 文字 + `--iris-sev-*-soft` 底，圆角 6px，可配 mono 大写 overline（如 `SEVERITY · MODERATE`）。

### 负责任 AI 组件（一等公民）
- 弃检提示 / 人工复核 / 模型溯源 / 医疗免责：用 `--iris-accent-soft` 底 + `--iris-accent` 文字的徽章，或独立提示条；位置醒目，不做成灰色脚注。

### 表单
- 输入：白底、`--iris-line` 描边、圆角 8px、紧凑纵向 padding。
- 焦点：`--iris-focus` 描边 + `--iris-accent-soft` 外发光环。

---

## 6. 动效（克制）

- 动效只服务于"理解"与"反馈"，不炫技。
- AI 活动（推理中、生成中）用克制的 `pulse-glow` / 呼吸点，青绿。
- 过渡时长 150–250ms，缓动 `cubic-bezier(.23,1,.32,1)`（ease-out 感）。
- 不做入场编排大动画、不做滚动视差、不做装饰性粒子。
- 尊重 `prefers-reduced-motion`：所有非必要动效在减动效偏好下关闭。

---

## 7. 布局

- 最大容器约 `1200px` 居中；正文阅读列更窄（约 680–760px）。
- 基准间距 8px；区块垂直间距 64–120px（编辑式留白节奏）。
- 断点：`<640` 移动 / `640–991` 平板 / `≥992` 桌面。
- 导航：顶部吸顶，瓷白底 + 发丝线；移动端折叠为抽屉。

---

## 8. 文案与气质

- 语气：专业、克制、有同理心。像一个严谨又体贴的临床助手。
- 不用夸张营销词、不用感叹号轰炸、不用"震惊""神器"类措辞。
- 医疗表述严谨：分级用标准术语（如 NPDR 分期），不夸大结论，始终配合"负责任 AI"提示。

---

## 9. Do / Don't

### Do
- 用暖瓷 `--iris-bg` 做页面底，卡片用 `--iris-surface`。
- 数字、指标、时间戳一律等宽。
- 严重度用语义色，且与品牌青绿解耦。
- 用发丝线 + 留白组织层级。
- 把负责任 AI 组件放在醒目位置。
- 衬线标题 weight 500–600。

### Don't
- 不用纯黑、纯白页面、冷蓝主色、紫蓝渐变。
- 不用厚重卡片大阴影。
- 不用 700+ 粗衬线。
- 不用彩色做纯装饰 / 大面积色块 / 渐变背景。
- 不混淆品牌色与严重度语义色。
- 不在非代码内容滥用等宽字体（等宽只给数据/代码/标签）。

---

## 10. 迁移与实施约束

- **不碰后端契约**：所有端点、请求/响应形状、数据流保持不变。
- **令牌单一真源**：以 `frontend/src/styles/design-system/variables.css` 为准（`--iris-*` 全部定义在此）；`frontend/src/assets/claude-tokens.css` 只放主题覆盖，`agent-theme.css` 逐步收编，禁止再造第三套。
- **ConfigProvider 与 CSS 变量同源**：antd 主题从同一组令牌读取，消除 JS 与 CSS 双源漂移。
- **分阶段**：阶段1 公开首页 → 阶段2 患者诊断流 → 阶段3 医生/管理台 → 阶段4 Agent 子系统与图表统一。每阶段可独立演示。
- **保留资产**：`medical/` 四个负责任 AI 组件（`AbstainNotice`、`HumanReviewBadge`、`MedicalDisclaimer`、`ModelProvenance`）与可重生成的 Swagger 契约必须保留并按本系统重皮。

### 实施状态（2026-11-04 复核）

- 令牌层已全部落地：`variables.css` 定义 `--iris-*`，`claude-tokens.css` 只剩深色主题覆盖。
- 页面改造完成 **3/20**：`HomePage.vue`、`user/UserLoginPage.vue`、`user/UserRegisterPage.vue`。
- 其余 **17 页仍是 Editorial 重构前的样式**（无 `--iris-*` 令牌、无 KPI 条骨架），按上面四个阶段继续推进。

---

## 11. Agent 快速参考

- 主 CTA / 强调：`--iris-accent (#1b7f6b)`
- 页面底：`--iris-bg (#f6f4ef)`；卡片：`--iris-surface (#fff)`
- 主文字：`--iris-ink (#16140f)`；次要：`--iris-ink-2 (#6f6a5e)`；注释：`--iris-ink-3 (#9a9587)`
- 发丝线：`--iris-line (#e6e2d8)`
- 严重度：低 `--iris-sev-low (#2f9e6e)` / 中 `--iris-sev-moderate (#b37708)` / 高 `--iris-sev-high (#c0392b)`
- 标题 Georgia serif；正文系统 sans；数字 JetBrains Mono
- 圆角 6/8/12；阴影极淡暖黑；焦点环青绿

**写组件时**：先想"这里需要颜色吗"，默认中性；只有"行动 / 严重度 / 负责任 AI"三类才上色。
