/**
 * API 时间解析与展示的唯一入口。
 *
 * <p><b>新契约：</b>后端输出带时区偏移的 ISO-8601
 * （`2026-11-08T18:20:00.000+08:00`）。按时间点解析，再用浏览器本地时区展示，
 * 不做任何手工加减小时。
 *
 * <p><b>旧数据：</b>历史接口曾经输出 `2026-11-08 10:20:00`——没有偏移，而且
 * 是 UTC 墙钟。原因是后端 `spring.jackson.date-format` 没有配套 `time-zone`，
 * Jackson 的 `java.util.Date` 默认按 UTC 格式化。所以这里把**无偏移**的
 * 日期时间按 UTC 解析；这是对旧契约的解析修正，不是给时区「加 8 小时」。
 * 无法识别的字符串返回 `null`，调用方据此放弃判断，而不是静默猜一个时区。
 */

/** 无偏移的日期时间（空格或 T 分隔都认）。 */
const NAIVE_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,9}))?$/

/** 结尾带 Z 或 ±HH:MM / ±HHMM 偏移。 */
const ZONED_SUFFIX = /(?:[zZ]|[+-]\d{2}:?\d{2})$/

/** 纯日期 `YYYY-MM-DD`。 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

export function parseApiDate(value?: string | null): Date | null {
  if (!value) return null
  const raw = value.trim()
  if (!raw) return null

  if (ZONED_SUFFIX.test(raw)) {
    const zoned = new Date(raw)
    return Number.isNaN(zoned.getTime()) ? null : zoned
  }

  const naive = NAIVE_DATE_TIME.exec(raw)
  if (naive) {
    // 旧契约：无偏移 = UTC 墙钟。
    const fraction = (naive[7] ?? "").padEnd(3, "0").slice(0, 3)
    const utc = Date.UTC(
      Number(naive[1]),
      Number(naive[2]) - 1,
      Number(naive[3]),
      Number(naive[4]),
      Number(naive[5]),
      Number(naive[6] ?? 0),
      Number(fraction || 0),
    )
    return new Date(utc)
  }

  const dateOnly = DATE_ONLY.exec(raw)
  if (dateOnly) {
    // 纯日期是「日历上的那一天」，按本地零点解释，避免跨时区掉到前一天。
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
  }

  const fallback = new Date(raw)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

/** 时间点 → epoch 毫秒；解析不出返回 null。 */
export function parseApiTime(value?: string | null): number | null {
  const date = parseApiDate(value)
  return date ? date.getTime() : null
}

const pad = (n: number) => String(n).padStart(2, "0")

/** 本地（或指定时区）的 HH:mm。 */
export function formatClock(date: Date, timeZone?: string): string {
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date)
    const hour = parts.find((p) => p.type === "hour")?.value ?? "00"
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00"
    return `${hour}:${minute}`
  }
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

type DayParts = { year: number; month: number; day: number }

function dayParts(date: Date, timeZone?: string): DayParts {
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date)
    return {
      year: Number(parts.find((p) => p.type === "year")?.value ?? 0),
      month: Number(parts.find((p) => p.type === "month")?.value ?? 0),
      day: Number(parts.find((p) => p.type === "day")?.value ?? 0),
    }
  }
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }
}

/** 时区无关的「哪一天」键；null 表示解析失败。 */
export function dayKey(value: string | Date | null | undefined, timeZone?: string): string | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : parseApiDate(value)
  if (!date) return null
  const { year, month, day } = dayParts(date, timeZone)
  return `${year}-${pad(month)}-${pad(day)}`
}

/** 昨天的 dayKey（按给定时间点所在时区/本地）。 */
export function yesterdayKey(now: Date, timeZone?: string): string {
  const previous = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  return dayKey(previous, timeZone) ?? ""
}

/**
 * 会话行内日期读数：今天/昨天给到时刻，更早只给日期。
 * 用真实 `updatedTime` 换算，不做「刚刚 / 3 分钟前」这类会随刷新失真的措辞。
 */
export function formatSessionStamp(
  value?: string,
  options: { now?: Date; timeZone?: string } = {},
): string {
  if (!value) return ""
  const time = parseApiDate(value)
  if (!time) return value.slice(0, 10)

  const now = options.now ?? new Date()
  const timeZone = options.timeZone
  const day = dayKey(time, timeZone)
  const today = dayKey(now, timeZone)
  const clock = formatClock(time, timeZone)
  const { year, month, day: dayOfMonth } = dayParts(time, timeZone)
  const nowParts = dayParts(now, timeZone)

  if (day === today) return `今天 ${clock}`
  if (day === yesterdayKey(now, timeZone)) return `昨天 ${clock}`
  if (year === nowParts.year) return `${pad(month)}-${pad(dayOfMonth)}`
  return `${year}-${pad(month)}-${pad(dayOfMonth)}`
}

/** `yyyy-MM-dd HH:mm`（本地/指定时区），用于记录纸与管理端读数。 */
export function formatLocalDateTime(value?: string, timeZone?: string): string {
  const date = parseApiDate(value)
  if (!date) return value ?? ""
  const { year, month, day } = dayParts(date, timeZone)
  return `${year}-${pad(month)}-${pad(day)} ${formatClock(date, timeZone)}`
}
