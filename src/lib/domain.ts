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

export function classCode(name?: string) {
  if (!name) return "—"
  const exact = CODE_BY_NAME[name]
  if (exact) return exact
  const hit = CLASSES.find((item) => name.includes(item.name) || item.name.includes(name))
  return hit?.code ?? "—"
}

const SEVERITY_LABEL: Record<string, string> = {
  normal: "正常",
  mild: "轻度",
  moderate: "中度",
  severe: "严重",
  NOT_ASSESSED: "未评估",
}

export function severityLabel(severity?: string) {
  if (!severity) return "未评估"
  return SEVERITY_LABEL[severity] ?? severity
}

export function severityRisk(severity?: string): Risk {
  switch (severity) {
    case "normal":
      return "normal"
    case "mild":
    case "moderate":
      return "attention"
    case "severe":
      return "critical"
    default:
      return "unknown"
  }
}

/** 复核状态 → 展示文案与风险色。 */
export function reviewState(status?: string): { label: string; risk: Risk } {
  switch (status) {
    case "APPROVED":
      return { label: "已签字", risk: "normal" }
    case "REJECTED":
      return { label: "已退回", risk: "critical" }
    case "PENDING":
      return { label: "待复核", risk: "attention" }
    case "PENDING_AI":
    default:
      return { label: "待复核", risk: "attention" }
  }
}

/** 置信度 → 风险分级。低于 0.6 视为不宜单独下结论。 */
export function confidenceRisk(confidence?: number): Risk {
  if (typeof confidence !== "number") return "unknown"
  if (confidence >= 0.75) return "normal"
  if (confidence >= 0.6) return "attention"
  return "critical"
}

/** 把 0–1 的概率格式化为两位小数，落成记录纸上的定宽读数。 */
export function fixed(value?: number, digits = 2) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—"
  return value.toFixed(digits)
}

/** 把可能是百分数（0–100）或概率（0–1）的置信度归一为 0–1。 */
export function normalizeConfidence(confidence?: number): number {
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

/** 主诊断 + 其他诊断合成按概率排序的八类分布。 */
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

  rows.sort((a, b) => b.probability - a.probability)
  const highest = rows[0]?.probability ?? 0

  return rows.map((row) => ({
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
