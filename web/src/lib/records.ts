/**
 * 判读记录的统计与展示聚合。
 *
 * KPI 从首页一次大页拉取在本地汇总——个人判读量是百级、千级的数据，
 * 前端算比后端再加聚合接口划算，且不用动后端契约。
 */

import { getMyStats } from "./api"
import type { DiagnosisManage } from "./api"

export type RecordStats = {
  /** 名下判读总数（分页信封的 total，不依赖拉满首页）。 */
  total: number
  /**
   * 有**真实严重度分级**的记录条数。`NOT_ASSESSED`、空值、AI 拒识都不算，
   * 它们不是「低风险」，是「没有分级」。
   */
  assessed: number
  /**
   * `assessed` 里 severity=severe 的条数。
   *
   * <p>`assessed === 0` 时这个 0 **没有医学含义**：界面必须显示「未评估」，
   * 不能把「全体未评估」渲染成「高风险 0」。后端当前（`DiagnosisServiceImpl`
   * 硬编码 `NOT_ASSESSED`）一直是这一支。
   */
  highRisk: number
  /** 待人工复核条数。拒识记录同样在复核队列里，也计入。 */
  awaitingReview: number
  /** 最近一次判读时间，没有记录时为 null。 */
  lastReadAt: string | null
}

/** 后端 `Severity` 里真正带临床分级的取值；`NOT_ASSESSED` 明确排除。 */
const GRADED_SEVERITIES = new Set(["normal", "mild", "moderate", "severe"])

/** reexamineStatus → 展示文案。0 未复审（历史值 1 同义）/ 2 复审中 / 3 已复审。 */
export function reexamineLabel(status?: number): string {
  switch (status) {
    case 2:
      return "复审中"
    case 3:
      return "已复审"
    default:
      return "未复审"
  }
}

/** 从一页记录里累加统计。total 用传入的 total（信封值），不数 records。 */
export function summarizeRecords(
  records: DiagnosisManage[],
  total: number,
): RecordStats {
  // 拒识记录的 result/confidence/severity 被后端清空；即便有残留 severity，
  // 拒识也不是一次分级结果，一律不计。
  const graded = records.filter(
    (item) =>
      !item.aiRejected &&
      typeof item.severity === "string" &&
      GRADED_SEVERITIES.has(item.severity),
  )
  const highRisk = graded.filter((item) => item.severity === "severe").length
  const awaitingReview = records.filter((item) => item.requiresReview).length
  const lastReadAt = records.reduce<string | null>((acc, item) => {
    if (!item.createTime) return acc
    return !acc || item.createTime > acc ? item.createTime : acc
  }, null)

  return { total, assessed: graded.length, highRisk, awaitingReview, lastReadAt }
}

/** 统计口径：all = 服务端全量聚合；page = 当前页本地汇总。 */
export type StatsScope = "all" | "page"

export type ScopedStats = {
  stats: RecordStats
  scope: StatsScope
}

/**
 * 统计口径的合成：服务端聚合优先，聚合不可用时退回本页汇总，口径随之
 * 标成 page——页面据此写明「本页」，不会把一页的数字冒充全量。
 *
 * 纯函数。聚合与列表是两个独立端点、并行发出，合成放在渲染期做：
 * 把两个请求串起来会让聚合等列表，聚合慢时整页都跟着慢。
 */
export function resolveScopedStats(
  serverStats: RecordStats | null,
  records: DiagnosisManage[],
  total: number,
): ScopedStats {
  if (serverStats) return { stats: serverStats, scope: "all" }
  return { stats: summarizeRecords(records, total), scope: "page" }
}

/**
 * 只取服务端聚合，不做降级：不可用时返回 null，由调用方在渲染期回退到
 * 本页汇总（见 resolveScopedStats）。它不依赖列表数据，所以能和列表请求
 * 并行发出。
 *
 * 任何失败（404 未实现、5xx、网络）都返回 null；200 但载荷不对
 * （空对象、null、缺字段、类型不对）同样返回 null——空 KPI 配「高风险」
 * 这种全量标签，比报错更糟。
 */
export async function loadServerStats(signal?: AbortSignal): Promise<RecordStats | null> {
  try {
    const stats = await getMyStats(signal)
    return isStatsPayload(stats) ? stats : null
  } catch (error) {
    // 取消不是「聚合不可用」：原样抛出，别把降级结果写进已作废的查询。
    if (signal?.aborted) throw error
    return null
  }
}

/** 聚合载荷的形状校验：五个字段齐全且类型正确。 */
function isStatsPayload(value: unknown): value is RecordStats {
  if (!value || typeof value !== "object") return false
  const payload = value as Record<string, unknown>
  const isCount = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n) && n >= 0
  return (
    isCount(payload.total) &&
    // assessed 必须随聚合一起返回：没有它就分不清「0 条高风险」和
    // 「一条都没分级」，旧形状不能冒充全量口径。
    isCount(payload.assessed) &&
    isCount(payload.highRisk) &&
    isCount(payload.awaitingReview) &&
    (payload.lastReadAt === null || typeof payload.lastReadAt === "string")
  )
}

export function statsLabels(scope: StatsScope): {
  total: string
  awaitingReview: string
  lastReadAt: string
} {
  if (scope === "all") {
    return {
      total: "判读总数 · TOTAL",
      awaitingReview: "待人工复核 · REVIEW",
      lastReadAt: "最近判读 · LAST",
    }
  }
  return {
    total: "判读总数 · TOTAL",
    awaitingReview: "本页待人工复核 · REVIEW",
    lastReadAt: "本页最近 · LAST",
  }
}

/** 高风险读数格：未知（无分级数据）与零（真的没有高风险）必须区分。 */
export type RiskCell = {
  label: string
  /** 直接上屏的读数；未知时是「未评估」而不是 0。 */
  value: string
  /** 读数下的口径说明，没有则为 null。 */
  note: string | null
  /** true = 严重度尚不可用，读数不是医学意义上的 0。 */
  unknown: boolean
}

/**
 * 高风险格的口径。
 *
 * <p>后端目前不产出真实严重度（`DiagnosisServiceImpl` 恒写 `NOT_ASSESSED`），
 * 所有记录都是「未评估」。此时显示「高风险 0」等于宣称筛查过且无人高危——
 * 这是医学语义上的假陈述。分级数据只有部分覆盖时，读数配「已分级 N/M 条」，
 * 让数字可核对。
 */
export function highRiskCell(
  stats: RecordStats,
  scope: StatsScope,
  pagePrefix = "本页",
): RiskCell {
  const page = scope === "page" ? pagePrefix : ""
  if (stats.assessed === 0) {
    return {
      label: `${page}严重度 · 未评估`,
      value: "未评估",
      note: "后端尚未产出严重度分级，高风险计数暂不可用",
      unknown: true,
    }
  }
  if (stats.assessed < stats.total) {
    return {
      label: `${page}高风险 · 已分级 ${stats.assessed}/${stats.total}`,
      value: String(stats.highRisk),
      note: `仅 ${stats.assessed} 条有分级数据，其余未评估`,
      unknown: false,
    }
  }
  return {
    label: `${page}高风险 · SEVERE`,
    value: String(stats.highRisk),
    note: null,
    unknown: false,
  }
}

export type ReexamineView = "receipt" | "request" | "reviewed" | null

/**
 * 复诊区块的三态。只要记录非拒识且有复审状态就渲染——
 * 重新打开一条「复审中」的记录也必须看到回执，不能整块消失。
 */
export function reexamineView(item: DiagnosisManage, reexamined: boolean): ReexamineView {
  if (item.aiRejected || item.reexamineStatus == null) return null
  if (reexamined || item.reexamineStatus === 2) return "receipt"
  return item.reexamineStatus === 3 ? "reviewed" : "request"
}

/** 「已复审 / 复审完成」的记录允许再申请复诊——复审中的不重复提交。 */
export function canRequestReexamine(item: DiagnosisManage): boolean {
  if (item.aiRejected) return false
  return item.reexamineStatus === 1 || item.reexamineStatus === 3
}
