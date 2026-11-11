/**
 * 图表数据整形（纯函数，无 React / DOM 依赖）。
 *
 * <p>图表组件只负责「把整形好的数据画出来」，所有会出错的口径都在这里算：
 * <ul>
 *   <li>上一等长窗口与当前窗口按天对齐——两个窗口长度相同、零填充过，
 *       直接按下标配对就行；</li>
 *   <li>按星期分布：给的是「窗口内累计按星期分桶」，读数要给的是
 *       <b>合计</b>与<b>日均</b>，不是最后一根柱子的值；</li>
 *   <li>环比：上期为 0 时没有可比基数，返回 null 而不是除零后的 Infinity。</li>
 * </ul>
 */

/** 一天的计数点。 */
export type DayPoint = { day: string; value: number }

/** 窗口内的一条日序列。 */
export type WindowPoint = { label: string; value: number }

/** 日期 → 轴标签：只留月-日，轴上要的是「哪天」不是「哪年」。 */
export function dayLabel(day: string): string {
  return day.length >= 10 ? day.slice(5) : day
}

/**
 * 把当前窗口与上一等长窗口按天对齐。
 *
 * @param days      当前窗口的日期序列（后端已零填充）
 * @param current   当前窗口的日计数
 * @param previous  上一窗口的日计数（长度应与 days 相同）
 */
export function alignPreviousWindow(
  days: string[],
  current: DayPoint[],
  previous: DayPoint[],
): (DayPoint & { label: string; previous: number })[] {
  return days.map((day, index) => ({
    day,
    label: dayLabel(day),
    value: current[index]?.value ?? 0,
    previous: previous[index]?.value ?? 0,
  }))
}

/** 周一 → 周日的标签，顺序即一周顺序。 */
export const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const

export type WeekdayBar = {
  label: string
  /** 该星期几在窗口内的合计。 */
  total: number
  /** 该星期几在窗口内出现了几天（30 天窗口里有的 5 天、有的 4 天）。 */
  occurrences: number
  /** 该星期几的日均 = 合计 ÷ 出现天数。 */
  average: number
}

export type WeekdayBreakdown = {
  bars: WeekdayBar[]
  /** 窗口内合计（这才是「新增注册」的真读数） */
  total: number
  /** 窗口内的日均（合计 ÷ 窗口天数） */
  average: number
  windowDays: number
}

/**
 * 日序列 → 按星期分桶。
 *
 * <p>读数口径：
 * <ul>
 *   <li>每根柱 = <b>该星期几的日均</b>（合计 ÷ 该星期几出现天数）；</li>
 *   <li>合计 = 全部柱的合计之和；</li>
 *   <li>窗口日均 = 合计 ÷ 窗口天数。</li>
 * </ul>
 *
 * <p>不能拿「累计值」直接比星期几：30 天窗口里周一出现 5 次、周二只出现 4 次，
 * 累计值会把「多出现一天」当成「周一更活跃」。必须先摊到每天，再比较。
 */
export function weekdayBreakdown(trend: DayPoint[], windowDays: number): WeekdayBreakdown {
  const totals = new Array(7).fill(0) as number[]
  const occurrences = new Array(7).fill(0) as number[]
  for (const row of trend) {
    const date = new Date(`${row.day}T00:00:00`)
    if (Number.isNaN(date.getTime())) continue
    // getDay(): 0=周日 → 转成 0=周一 … 6=周日
    const index = (date.getDay() + 6) % 7
    totals[index] += row.value
    occurrences[index] += 1
  }
  const bars: WeekdayBar[] = WEEKDAY_LABELS.map((label, index) => ({
    label,
    total: totals[index],
    occurrences: occurrences[index],
    average: occurrences[index] > 0 ? totals[index] / occurrences[index] : 0,
  }))
  const total = bars.reduce((sum, bar) => sum + bar.total, 0)
  const days = Number.isFinite(windowDays) && windowDays > 0 ? windowDays : 1
  return { bars, total, average: total / days, windowDays: days }
}

/**
 * 环比变化率：上期为 0 时没有可比基数，返回 null。
 *
 * <p>不返回 Infinity 也不返回 0%——「上期为 0」和「持平」是两件事，
 * 前者要说「上期为 0」，后者才写 ±0.0%。
 */
export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  if (previous <= 0) return null
  return (current - previous) / previous
}

/** 环比读数文案：给 KPI 的 delta 用。 */
export function changeLabel(current: number, previous: number): string {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return "无可比基数"
  if (previous <= 0) return current > 0 ? "上期为 0" : "上期与本期均为 0"
  const delta = (current - previous) / previous
  const sign = delta > 0 ? "+" : ""
  return `较上期 ${sign}${(delta * 100).toFixed(1)}%`
}

/**
 * 小倍数的统一 Y 尺度上限。
 *
 * <p>各病种各画各的归一化折线时，日增 2 条的病种和日增 200 条的病种
 * 看起来一样高——那是假的。传同一个 domainMax，各格才可比。
 */
export function sharedDomainMax(series: number[][]): number {
  let max = 0
  for (const points of series) {
    for (const value of points) {
      if (Number.isFinite(value) && value > max) max = value
    }
  }
  return max > 0 ? max : 1
}
