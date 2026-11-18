import type { DiagnosisResult } from "@/lib/api"

export type Risk = "normal" | "attention" | "critical" | "unknown"

/** 模型覆盖的八类眼底改变。code 为记录纸上使用的短码。 */
export const CLASSES = [
  { code: "N", name: "正常", desc: "未见明显异常，血管走行与视盘边界正常。" },
  { code: "AMD", name: "年龄相关性黄斑变性", desc: "黄斑区玻璃膜疣、色素改变或新生血管。" },
  { code: "CAT", name: "白内障", desc: "晶状体混浊，影像对比度下降。" },
  { code: "DR", name: "糖尿病视网膜病变", desc: "微血管瘤、出血、硬性渗出与棉絮斑。" },
  { code: "GLA", name: "青光眼", desc: "视杯扩大、神经纤维层缺损。" },
  { code: "HR", name: "高血压性视网膜病变", desc: "动脉变细、动静脉交叉压迹。" },
  { code: "PM", name: "病理性近视", desc: "豹纹状眼底、后巩膜葡萄肿、漆裂纹。" },
  { code: "OTH", name: "其他", desc: "存在异常但无法归入以上七类。" },
] as const

const CODE_BY_NAME: Record<string, string> = Object.fromEntries(
  CLASSES.map((item) => [item.name, item.code]),
)

/**
 * 别名 → 规范类名。
 *
 * <p>真实判读响应里同一个类别会以三种写法出现：
 * 算法侧的英文标签（`diabetes`）、后端枚举的中文短名（`糖尿病`）、
 * 以及记录纸用的规范名（`糖尿病视网膜病变`）。三处不统一的话，
 * 记录纸的概率表会出现英文行、「—」短码，以及主诊断被列两遍。
 *
 * <p>这里的别名表是**前端展示口径**，不新增也不修改后端契约：
 * 后端给什么，前端都要归到 `CLASSES` 里的同一类；实在认不出的原样显示，不猜。
 */
const CLASS_ALIASES: Record<string, string> = {
  // 算法侧英文标签
  normal: "正常",
  amd: "年龄相关性黄斑变性",
  cataract: "白内障",
  diabetes: "糖尿病视网膜病变",
  glaucoma: "青光眼",
  hypertension: "高血压性视网膜病变",
  myopia: "病理性近视",
  other: "其他",
  // 后端枚举的中文短名
  糖尿病: "糖尿病视网膜病变",
  高血压: "高血压性视网膜病变",
  近视: "病理性近视",
}

/**
 * 把任意写法的类别名归到 `CLASSES` 里的规范名。
 *
 * @returns 规范类名；认不出时返回 `null`（调用方按「未知类别」处理，不猜）。
 */
export function canonicalClassName(name?: string): string | null {
  if (!name) return null
  const trimmed = name.trim()
  if (!trimmed) return null

  const alias = CLASS_ALIASES[trimmed.toLowerCase()]
  if (alias) return alias
  if (CODE_BY_NAME[trimmed]) return trimmed

  // 「疑似糖尿病视网膜病变」「糖尿病视网膜病变（DR）」这类带修饰的写法。
  const hit = CLASSES.find((item) => trimmed.includes(item.name) || item.name.includes(trimmed))
  return hit?.name ?? null
}

export function classCode(name?: string) {
  if (!name) return "—"
  const exact = CODE_BY_NAME[name]
  if (exact) return exact
  const canonical = canonicalClassName(name)
  if (canonical) return CODE_BY_NAME[canonical] ?? "—"
  return "—"
}

/** 规范名 → 库内原始标签（后端落库值）。 */
const CLASS_SEARCH_LABELS: Record<string, string> = {
  正常: "正常",
  年龄相关性黄斑变性: "年龄相关性黄斑变性",
  白内障: "白内障",
  糖尿病视网膜病变: "糖尿病",
  青光眼: "青光眼",
  高血压性视网膜病变: "高血压",
  病理性近视: "近视",
  其他: "其他",
}

/**
 * 输入 → 命中的规范类名（按别名表 + 子串关系）。
 *
 * <p>子串匹配让「病理性」这类只写一半的输入也能落到一个类上；
 * 命中多个时（`视网膜病变` 同时是 DR 与 HR 的子串）返回多个，
 * 由调用方决定怎么提示——后端只在 `result` 一列上做 LIKE，覆盖不了多值。
 */
export function classSearchMatches(name?: string): string[] {
  const trimmed = name?.trim() ?? ""
  if (!trimmed) return []
  const alias = CLASS_ALIASES[trimmed.toLowerCase()]
  if (alias) return [alias]
  if (CODE_BY_NAME[trimmed]) return [trimmed]
  return CLASSES.filter(
    (item) => trimmed.includes(item.name) || item.name.includes(trimmed),
  ).map((item) => item.name)
}

/**
 * 库里可能出现的**原值集合**：后端枚举的中文短名 ∪ 算法侧的英文标签。
 *
 * <p>不是所有落库值都走 `getChineseLabelByEnglishLabel`：历史数据里有直接写
 * 英文标签的行（本机 3306 实存一条 `result='myopia'`）。这些值照抄进筛选框
 * 本来就查得到，换算成另一个标签反而把这一类行查丢。
 */
const STORED_LABELS = new Set<string>([
  ...Object.values(CLASS_SEARCH_LABELS),
  ...Object.keys(CLASS_ALIASES),
])

/**
 * 输入 → 库内原始标签（检索用）。
 *
 * <p>后端 `DiagnosisCategoryEnum` 落库的是短名，与前端规范名有三处不同：
 * 糖尿病 / 高血压 / 近视。管理端的筛选最终落到后端
 * `queryWrapper.like("result", …)`——按库内原值模糊匹配，**不认规范名**。
 * 用户在列表里看到的是规范名，照抄进筛选框会一条都查不到。
 *
 * <p>两种情况原样透传，不换算：
 * <ol>
 *   <li>输入**本身就是库内原值**（中文短名或英文标签）——换算会把这一类行查丢；</li>
 *   <li>命中多个规范类——后端单列 LIKE 一次覆盖不了，宁可原样检索，
 *       也不静默只查其中一个（界面会提示命中的候选类别）。</li>
 * </ol>
 *
 * @param name 用户输入；命中唯一规范名时返回库内标签，否则返回 `null`（原样检索）。
 */
export function classSearchLabel(name?: string): string | null {
  const trimmed = name?.trim() ?? ""
  if (!trimmed) return null
  // 输入已经是库内原值：原样透传（英文标签 'myopia' 换算成 '近视' 就查不到那一行）。
  if (STORED_LABELS.has(trimmed) || STORED_LABELS.has(trimmed.toLowerCase())) {
    return trimmed
  }
  const matches = classSearchMatches(name)
  if (matches.length !== 1) return null
  return CLASS_SEARCH_LABELS[matches[0]] ?? null
}

/** 检索口径提示：换算对照、命中歧义，都要写在脸上。 */
export function classSearchHint(name?: string): string | null {
  const trimmed = name?.trim() ?? ""
  if (!trimmed) return null
  const matches = classSearchMatches(trimmed)
  if (matches.length === 0) return null
  if (matches.length > 1) {
    // 多命中：原样透传给后端（LIKE 可能同时命中多类），把候选写出来供人挑。
    return `「${trimmed}」可能命中 ${matches.length} 个类别：${matches.join(" / ")} · 可补全类别名缩小范围`
  }
  const canonical = matches[0]
  const label = CLASS_SEARCH_LABELS[canonical]
  if (!label) return null
  // 输入本身就是库内原值（例：糖尿病 / myopia）：不换算，只告诉它属于哪一类。
  if (label === trimmed || STORED_LABELS.has(trimmed.toLowerCase())) {
    return canonical === trimmed ? null : canonical
  }
  if (label === canonical) return null
  return canonical === trimmed
    ? `${canonical} → ${label}`
    : `「${trimmed}」→ ${canonical}（库内：${label}）`
}

const SEVERITY_LABEL: Record<string, string> = {
  normal: "正常",
  mild: "轻度",
  moderate: "中度",
  severe: "严重",
  // 人工严重程度用另一组值（管理端下拉写入的就是这一组）。此前这里没有它们，
  // 患者端记录纸会把「high」原样显示出来——同一字段两种语言。
  low: "低风险",
  medium: "中风险",
  high: "高风险",
  NOT_ASSESSED: "未评估",
}

export function severityLabel(severity?: string) {
  if (!severity) return "未评估"
  // 大小写不敏感：人工严重程度既有 "high"（管理端下拉写入），也可能出现
  // "MODERATE" 这类大写写法；查不到就原样返回，绝不吞掉未知取值。
  return (
    SEVERITY_LABEL[severity] ??
    SEVERITY_LABEL[severity.toUpperCase()] ??
    SEVERITY_LABEL[severity.toLowerCase()] ??
    severity
  )
}

export function severityRisk(severity?: string): Risk {
  // 与 severityLabel 同样大小写不敏感，避免 "HIGH" 落到 unknown。
  const key = severity?.toUpperCase()
  switch (key) {
    case "NORMAL":
      return "normal"
    case "MILD":
    case "LOW":
    case "MODERATE":
    case "MEDIUM":
      return "attention"
    case "SEVERE":
    case "HIGH":
      return "critical"
    default:
      return "unknown"
  }
}

/**
 * 人工复核状态 → 展示文案与风险色。
 *
 * <p>取值来自后端 {@code HumanReviewStatus}（PENDING_AI / AI_ONLY / AWAITING_REVIEW /
 * REVIEWED / OVERRIDDEN）。三条不能混的说法：
 *
 * <ul>
 *   <li>AI_ONLY = **只有 AI 结论，没有进入复核队列**。以前这里统一显示「待复核」，
 *       等于替系统承诺了一件没发生的事：队列里根本没有这条。</li>
 *   <li>AWAITING_REVIEW 才是真的进了队列。</li>
 *   <li>REVIEWED 只说明**有人做过人工复核**，不说明那个人是医生——本系统没有
 *       可核验的临床资质，复核人角色看 {@code source.reviewerRole}（D-01b）。</li>
 * </ul>
 */
export function humanReviewState(status?: string | null): { label: string; risk: Risk } {
  switch (status) {
    case "PENDING_AI":
      return { label: "待模型出结论", risk: "unknown" }
    case "AI_ONLY":
      return { label: "仅 AI 结论 · 未进入复核队列", risk: "unknown" }
    case "AWAITING_REVIEW":
      return { label: "已进入复核队列 · 待复核", risk: "attention" }
    case "REVIEWED":
      return { label: "人工复核已记录", risk: "normal" }
    case "OVERRIDDEN":
      return { label: "人工结论已推翻 AI", risk: "attention" }
    default:
      return { label: "未记录", risk: "unknown" }
  }
}

/**
 * 记录来源 → 展示文案。
 *
 * <p>只陈述「这条记录挂在哪个流程上」：`COLLABORATION_DRAFT` 说明它由协作草稿生成，
 * **不**说明草稿已获批、患者已授权——那两件事分别看 `draftReviewState` 与
 * `authorizationState`。把它们折叠成一句「已授权诊断」就是在编事实。
 */
export function recordSourceLabel(source?: string | null): string {
  switch (source) {
    case "DIRECT":
      return "本人上传 · 直接判读"
    case "COLLABORATION_DRAFT":
      return "协作任务 · 由草稿生成"
    default:
      return "未记录"
  }
}

/** 协作草稿审核状态 → 文案。无关联草稿返回 null（调用方整行不显示）。 */
export function draftReviewLabel(state?: string | null): string | null {
  switch (state) {
    case "APPROVED":
      return "草稿已审核通过"
    case "REJECTED":
      return "草稿被退回"
    case "PENDING":
      return "草稿待审核"
    default:
      return null
  }
}

/**
 * 患者授权保存 → 文案。授权**不等于**临床人工复核，也不等于草稿获批。
 *
 * <p>回执只给前缀：完整回执是否对本人开放是产品决策，前端不补全也不展示全文。
 */
export function authorizationLabel(
  state?: string | null,
  authorizedAt?: string | null,
  receipt?: string | null,
): string {
  switch (state) {
    case "APPROVED": {
      const when = authorizedAt ? ` · ${authorizedAt}` : ""
      const code = receipt ? ` · 回执 ${receipt}` : ""
      return `患者已授权保存${when}${code}`
    }
    case "OFFERED":
      return "已向患者提出，待授权"
    case "EXPIRED":
      return "授权已过期"
    default:
      return "无授权记录"
  }
}

/**
 * 影像归档状态 → 文案。
 *
 * <p>刻意不用「有没有公开 URL」代替：协作影像按隐私策略不提供公开地址，
 * 但对象**确实归档了**，把它显示成「未保存」就是在说一件不成立的事。
 * `ARCHIVED` 也只说「记录里有这个地址」，本轮没有存储侧存在性探测。
 */
export function archivalLabel(state?: string | null): string {
  switch (state) {
    case "ARCHIVED":
      return "已归档 · 有公开地址"
    case "ARCHIVED_NOT_PUBLIC":
      return "已归档 · 按隐私策略不公开"
    case "NOT_ARCHIVED":
      return "未留存影像"
    default:
      return "归档状态无法确认"
  }
}

/**
 * 复核人角色 → 文案（D-01b）。
 *
 * <p>**只说账号角色，不说职称**：系统里没有可核验的执业资质数据源，
 * 把 `admin` 的操作写成「医生复核」是伪造医学事实。角色本身也照原码给出，
 * 便于核对。
 */
export function reviewerRoleLabel(role?: string | null): string {
  switch (role) {
    case "doctor":
      return "医生（doctor）"
    case "admin":
      return "管理员（admin）"
    case "user":
      return "普通用户（user）"
    case null:
    case undefined:
    case "":
      return "未记录"
    default:
      return role
  }
}

/**
 *
 * 三档，不把 0.4 与 0.6 折叠成同一个标签：患者看到「低置信」时无从判断该多担心，
 * 两档折叠等于把风险信息直接丢掉。阈值沿用 0.75 / 0.60（低于 0.6 不宜单独下结论）。
 */
export type ConfidenceBand = {
  /** 档位标签，直接给患者看。 */
  label: string
  risk: Risk
}

/** 置信度 → 分档。缺省或非数值读作「未评估」，不猜。 */
export function confidenceBand(confidence?: number | null): ConfidenceBand {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) {
    return { label: "未评估", risk: "unknown" }
  }
  const value = normalizeConfidence(confidence)
  if (value >= 0.75) return { label: "可信", risk: "normal" }
  if (value >= 0.6) return { label: "偏低", risk: "attention" }
  return { label: "低", risk: "critical" }
}

/**
 * 置信度 → 百分比读数（一位小数，带 %）。
 *
 * 全站唯一口径：后端给 0–1 概率或 0–100 百分数都先归一到 0–1 再乘 100。
 * 患者端与后台读同一个数，不再一个显示 0.78 一个显示 78.0%。
 *
 * 「没有结论」与「结论是零」是两回事：undefined / null / NaN 一律显示「—」。
 */
export function confidencePercent(value?: number | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—"
  return `${(normalizeConfidence(value) * 100).toFixed(1)}%`
}

/** 把可能是百分数（0–100）或概率（0–1）的置信度归一为 0–1。 */
export function normalizeConfidence(confidence?: number | null): number {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) return 0
  return confidence > 1 ? Math.min(confidence / 100, 1) : Math.max(confidence, 0)
}

export type RankedClass = {
  code: string
  name: string
  probability: number
  top: boolean
  benign: boolean
}

/**
 * 主诊断 + 其他诊断合成按概率排序的类别分布。
 *
 * <p>真实响应里 `result` 是后端给的中文名，`otherDisease` 是算法给的英文标签，
 * 而且 top-1 会同时出现在两边——不归一就会把同一类列两遍、并且混进英文行。
 * 这里先归一到规范类名，再按类去重（同一类取概率大的那个），最后排序。
 */
export function rankClasses(result?: DiagnosisResult): RankedClass[] {
  if (!result) return []

  const rows: { name: string; probability: number }[] = []
  if (result.result) {
    rows.push({
      name: result.result,
      probability:
        typeof result.probability === "number"
          ? normalizeConfidence(result.probability)
          : normalizeConfidence(result.confidence),
    })
  }
  for (const item of result.otherDisease ?? []) {
    if (!item?.name) continue
    rows.push({
      name: item.name,
      probability: normalizeConfidence(item.probability),
    })
  }

  // 同一类只留一行：取概率大的那条，别把主诊断列两遍。
  const merged = new Map<string, { name: string; probability: number }>()
  for (const row of rows) {
    const key = canonicalClassName(row.name) ?? row.name.trim()
    const hit = merged.get(key)
    if (!hit || row.probability > hit.probability) {
      merged.set(key, { name: key, probability: row.probability })
    }
  }

  const list = [...merged.values()]
  list.sort((a, b) => b.probability - a.probability)
  const highest = list[0]?.probability ?? 0

  return list.map((row) => ({
    code: classCode(row.name),
    name: row.name,
    probability: row.probability,
    top: row.probability === highest,
    benign: row.name.includes("正常"),
  }))
}

export function recommendationLines(result?: DiagnosisResult): string[] {
  const raw = result?.recommendations
  if (!raw) return []
  return raw
    .split(/\r?\n|；/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * 急症措辞。
 *
 * 只认「骤变 + 特异表现 + 立即处置」这一类。像「视力下降」「注意休息」这种泛化描述
 * 出现在绝大多数建议里，一旦也算急症，红色标记就变成背景噪声——标记一旦泛滥，
 * 等于没有标记。
 */
const URGENT_ADVICE =
  /(视力骤降|骤降|突发性?视力|突然.{0,4}看不清|飞蚊骤增|闪光感|视野缺损|视野突然变窄|黑影遮挡|剧烈眼痛|眼球突出|复视|立即就医|尽快就医|前往急诊|急诊科)/

/** 这条建议是不是急症。 */
export function isUrgentAdvice(line: string): boolean {
  return URGENT_ADVICE.test(line)
}

/**
 * 模型没给出建议时的兜底。
 *
 * 活路径必须自带急症分流：硬编码的示例数据里有「飞蚊骤增请立即就诊」，
 * 真实判读却没有，患者在空建议页上看不到任何「什么时候必须马上就医」。
 */
export const TRIAGE_FALLBACK =
  "本次判读未给出个体化建议。如出现视力骤降、飞蚊骤增、闪光感或视野缺损，请立即前往眼科急诊，不要等待判读结果。"

export function formatTimestamp(value?: string) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** 权重指纹在记录纸上只留首尾，保持可核对又不喧宾夺主。 */
export function shortHash(hash?: string) {
  if (!hash) return "—"
  if (hash.length <= 14) return hash
  return `${hash.slice(0, 6)}…${hash.slice(-6)}`
}
