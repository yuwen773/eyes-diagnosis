/**
 * 管理后台纯函数层。只做「展示映射」与「动作守卫」两类判定，不发请求、不碰 DOM，
 * 便于表格/图表多处复用，也便于把 Vue 版踩过的坑固化成回归用例。
 */

import type { Risk } from "@/lib/domain"
import type { AdminDiagnosis, AdminUser } from "@/lib/adminApi"

/** 复审状态 → 标签与风险档。优先级：aiRejected > requiresReview > reexamineStatus。 */
export function reviewView(
  rec: Pick<AdminDiagnosis, "reexamineStatus" | "requiresReview" | "aiRejected">,
): { label: string; risk: Risk; tone: "ai" | "review" | "plain" } {
  // AI 拒识是最强信号：模型根本没下结论，必须压过任何人工复核状态。
  // 否则一条废记录若恰为「已复审」会被显示成已确认，误导医生。
  if (rec.aiRejected === true) {
    return { label: "AI 拒识", risk: "critical", tone: "ai" }
  }
  // 「待人工复核」是待办动作，优先于只记录流程进度的 reexamineStatus，
  // 让管理员先看到「该做什么」而不是「走到哪一步」。
  if (rec.requiresReview === true) {
    return { label: "待人工复核", risk: "attention", tone: "review" }
  }
  switch (rec.reexamineStatus) {
    case 2:
      return { label: "复审中", risk: "attention", tone: "plain" }
    case 3:
      return { label: "已复审", risk: "normal", tone: "plain" }
    case 1:
    case 0:
    default:
      // 状态 1 / 0 / 缺省都归「未复审」：后端没写入状态时不能显示成已复审。
      return { label: "未复审", risk: "attention", tone: "plain" }
  }
}

/**
 * 新闻发布状态 → 标签与风险档。后端 t_news.status 语义：
 * 0 草稿 / 1 已发布 / 2 下架 / 3 待审核。
 *
 * 缺省（字段缺席或非法值）一律读成「未知」而不是「草稿」：老数据里没写状态的
 * 新闻不能凭空显示成草稿，让管理员以为它还没发出去。
 */
export function newsStatusView(status?: number | null): {
  label: string
  risk: Risk
} {
  switch (status) {
    case 0:
      return { label: "草稿", risk: "attention" }
    case 1:
      return { label: "已发布", risk: "normal" }
    case 2:
      return { label: "已下架", risk: "critical" }
    case 3:
      return { label: "待审核", risk: "attention" }
    default:
      return { label: "未知", risk: "unknown" }
  }
}

/** 新闻发布状态的可选项（编辑页下拉与列表标签同源，避免两处各写一套文案）。 */
export const NEWS_STATUS_OPTIONS = [
  { value: 0, label: "草稿" },
  { value: 3, label: "待审核" },
  { value: 1, label: "已发布" },
  { value: 2, label: "已下架" },
] as const

/**
 * 后端 NewsLifecycleService 的合法状态迁移表，键为当前状态、值为可切换到的状态。
 * 包含「切到自身」：编辑正文但不改状态时是幂等的，后端同样放行。
 * 与后端不一致时后端会回「非法状态迁移」，前端提前收窄只是少发注定失败的请求。
 */
const NEWS_STATUS_TRANSITIONS: Record<number, readonly number[]> = {
  0: [0, 3, 1],
  3: [3, 1, 0, 2],
  1: [1, 2, 0],
  2: [2, 1, 0, 3],
}

/**
 * 当前状态下可选择的发布状态。
 * 老数据没有 status（null/undefined）时返回全量：保留原值仍是安全默认，
 * 但若管理员主动改状态，由后端按「来源状态未知」拒绝并给出可读错误。
 */
export function newsStatusOptionsFor(
  current?: number | null,
): Array<{ value: number; label: string }> {
  if (current == null || !(current in NEWS_STATUS_TRANSITIONS)) {
    return NEWS_STATUS_OPTIONS.map((option) => ({ ...option }))
  }
  return NEWS_STATUS_OPTIONS.filter((option) =>
    NEWS_STATUS_TRANSITIONS[current].includes(option.value),
  ).map((option) => ({ ...option }))
}

/** 用户删除守卫：目标是 admin 不给删（修正 Vue 版写反的守卫）。 */export function canDeleteUser(target?: AdminUser | null): boolean {
  // 目标缺失直接不给删：空白行或未选中就点删除，不该发出带空 id 的请求。
  // 只拦 admin；普通用户与角色字段缺失的旧数据放行，避免误伤可删记录。
  return target != null && target.userRole !== "admin"
}

/** 新闻正文长度守卫：后端 content.substring(0,30) 对 <30 字抛异常。 */
export function newsContentValid(content: string): boolean {
  // 按「有效正文」量长度而非原始长度：29 字正文补两个空格凑到 31 字，
  // 仍不该放行——摘要只取正文，空白不算内容。
  // 注意：brief 内联规则写的是 content.length >= 30（不 trim），但逐字落地的
  // 「29 字加空白仍拦」用例原始长度为 31，该规则会返回 true 与用例冲突；
  // 为保证逐字落地的测试通过，这里以 trim 后的长度判定（详见 task-2-report.md）。
  return content.trim().length >= 30
}

export type Ranked = { name: string; value: number; share: number }

/** 分布排序：value 降序，share = value/total（total 0 时 share 全 0）。 */
export function rankDistribution(rows: { name: string; value: number }[]): Ranked[] {
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  // 复制后再排序：纯函数不该改动调用方传入的数组顺序。
  return [...rows]
    .sort((a, b) => b.value - a.value)
    .map((row) => ({
      name: row.name,
      value: row.value,
      // total 为 0 时 value/total 会得到 NaN，图表读到 NaN 会画不出来，统一给 0。
      share: total === 0 ? 0 : row.value / total,
    }))
}

/** 横条内标签放得下吗：估计宽 = 名称字符数 × 12px + 16px 内边距，超过条宽则放不下。 */
export function barLabelFits(barWidthPx: number, label: string): boolean {
  // 中文等宽近似 + 左右各 8px 内边距；宽度不够就让标签移到条外，避免文字被裁。
  return label.length * 12 + 16 <= barWidthPx
}

/**
 * 置信度 → 百分比读数（一位小数，带 %）。
 *
 * 实现放在 domain.ts，患者端与后台共用同一份口径：后端置信度可能是 0–1 概率，
 * 也可能是 0–100 百分数，先经 normalizeConfidence 归一再 ×100，两种量纲都读得对。
 *
 * 「没有结论」与「结论是零」是两回事：undefined / null / NaN 一律显示「—」。
 * AI 拒识的记录后端把置信度置空（null），若照 normalizeConfidence 收成 0 再显示，
 * 页面会把一条拒识记录读成「0.0% 的诊断」——那是在说一条不存在的结论。
 */
export { confidencePercent } from "@/lib/domain"

/* ══════════════════════════════════════════════════════════════════════════
   筛选与统计的纯函数层
   --------------------------------------------------------------------------
   这些映射被多个页面复用：表格里的状态标签、工具条里的下拉选项、统计图里
   的中文口径，必须是同一份。写在一处，页面各处只消费，不再各写一套。
   ══════════════════════════════════════════════════════════════════════════ */

/** 用户角色 → 标签与风险档。只吃 --risk-* 语义色，与品牌信号橙解耦。 */
export function userRoleView(role?: string | null): { label: string; risk: Risk } {
  switch (role) {
    case "admin":
      return { label: "管理员", risk: "attention" }
    case "ban":
      return { label: "已封禁", risk: "critical" }
    case "user":
      return { label: "普通用户", risk: "normal" }
    default:
      // 未知角色不猜：老数据里没写角色的账号按「未标注」显示，
      // 而不是被显示成「普通用户」。
      return { label: role || "未标注", risk: "unknown" }
  }
}

/** 角色筛选下拉（值即后端 userRole，空串 = 不限）。 */
export const USER_ROLE_FILTER_OPTIONS = [
  { value: "", label: "全部角色" },
  { value: "user", label: "普通用户" },
  { value: "admin", label: "管理员" },
  { value: "ban", label: "已封禁" },
] as const

/** 可被指派的角色（新建 / 编辑 / 批量改角色都用这一份）。 */
export const USER_ROLE_ASSIGN_OPTIONS = [
  { value: "user", label: "普通用户" },
  { value: "ban", label: "已封禁" },
  { value: "admin", label: "管理员" },
] as const

/** 知识文档处理状态 → 标签与风险档。 */
export function knowledgeStatusView(status?: number | null): { label: string; risk: Risk } {
  switch (status) {
    case 0:
      return { label: "处理中", risk: "attention" }
    case 1:
      return { label: "已完成", risk: "normal" }
    case 2:
      return { label: "失败", risk: "critical" }
    default:
      return { label: "未知", risk: "unknown" }
  }
}

/** 知识文档状态筛选下拉。 */
export const KNOWLEDGE_STATUS_FILTER_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "0", label: "处理中" },
  { value: "1", label: "已完成" },
  { value: "2", label: "失败" },
] as const

/** 知识库支持的文件类型（与后端白名单一致）。 */
export const KNOWLEDGE_FILE_TYPES = [
  "pdf",
  "doc",
  "docx",
  "txt",
  "md",
  "markdown",
] as const

/** 知识文档类型筛选下拉。 */
export const KNOWLEDGE_FILE_TYPE_OPTIONS = [
  { value: "", label: "全部类型" },
  ...KNOWLEDGE_FILE_TYPES.map((value) => ({ value, label: value.toUpperCase() })),
] as const

/**
 * 判读记录的复核状态筛选。
 *
 * 值是自造的语义键，落到后端参数时再翻译（见 diagnosisFilterParams）：
 * 后端的 reexamineStatus 是复诊流程状态，humanReviewStatus 是医生复核状态，
 * 两套语义混在一张表里，前端不直接暴露它们的数字。
 */
export type DiagnosisReviewFilter =
  | ""
  | "requiresReview"
  | "aiRejected"
  | "reviewed"
  | "reviewing"
  | "notReviewed"

export const DIAGNOSIS_REVIEW_FILTER_OPTIONS: {
  value: DiagnosisReviewFilter
  label: string
}[] = [
  { value: "", label: "全部状态" },
  { value: "requiresReview", label: "待人工复核" },
  { value: "aiRejected", label: "AI 拒识" },
  { value: "reviewed", label: "已复审" },
  { value: "reviewing", label: "复审中" },
  { value: "notReviewed", label: "未复审" },
]

/** 复核状态筛选 → 后端查询参数。空串返回空对象（不限）。 */
export function diagnosisFilterParams(key: DiagnosisReviewFilter): {
  reexamineStatus?: number
  humanReviewStatus?: string
  aiRejected?: boolean
  requiresReview?: boolean
} {
  switch (key) {
    case "requiresReview":
      return { requiresReview: true }
    case "aiRejected":
      return { aiRejected: true }
    case "reviewed":
      return { reexamineStatus: 3 }
    case "reviewing":
      return { reexamineStatus: 2 }
    case "notReviewed":
      return { reexamineStatus: 1 }
    default:
      return {}
  }
}

/**
 * 人工复核状态（humanReviewStatus）→ 中文标签。
 *
 * 这列后端给的是代码（PENDING_AI / AI_ONLY / …），仪表盘与数据分析要显示
 * 人话；映射写在这里，两页共用一份。
 */
export function humanReviewStatusLabel(status?: string | null): string {
  switch (status) {
    case "PENDING_AI":
      return "待模型出结论"
    case "AI_ONLY":
      return "仅 AI 结论 · 待复核"
    case "AWAITING_REVIEW":
      return "拒识 / 低置信 · 待复核"
    case "REVIEWED":
      return "已复核"
    case "OVERRIDDEN":
      return "已推翻 AI 结论"
    default:
      return "未记录"
  }
}

/** 计数读数：千分位 + 等宽字体（在 StatTile 里用）。 */
export function formatStatNumber(value: number): string {
  if (!Number.isFinite(value)) return "—"
  return Math.round(value).toLocaleString("zh-CN")
}

/** 百分比读数（一位小数）。入参是 0–1 的比例。 */
export function formatStatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${(value * 100).toFixed(1)}%`
}
