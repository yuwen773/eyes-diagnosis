import { describe, expect, it } from "vitest"

import {
  dayKey,
  formatClock,
  formatLocalDateTime,
  formatSessionStamp,
  parseApiDate,
  parseApiTime,
  yesterdayKey,
} from "./time"

const SHANGHAI = "Asia/Shanghai"

describe("parseApiDate", () => {
  it("带偏移的 ISO 按时间点解析：UTC 10:20 = Asia/Shanghai 18:20", () => {
    const date = parseApiDate("2026-11-08T10:20:00.000Z")
    expect(date).not.toBeNull()
    expect(date?.toISOString()).toBe("2026-11-08T10:20:00.000Z")
    expect(formatClock(date as Date, SHANGHAI)).toBe("18:20")
  })

  it("+08:00 偏移与等价的 Z 时间是同一个时间点", () => {
    const shanghai = parseApiDate("2026-11-08T18:20:00+08:00")
    const utc = parseApiDate("2026-11-08T10:20:00Z")
    expect(shanghai?.getTime()).toBe(utc?.getTime())
  })

  it("旧契约的无偏移字符串按 UTC 解析（不是本地、不是 +8）", () => {
    const legacy = parseApiDate("2026-11-08 10:20:00")
    expect(legacy?.getTime()).toBe(Date.UTC(2026, 10, 8, 10, 20, 0))
    expect(formatClock(legacy as Date, SHANGHAI)).toBe("18:20")
    // T 分隔、毫秒、缺秒都走同一条 UTC 规则
    expect(parseApiDate("2026-11-08T10:20:00")?.getTime()).toBe(
      Date.UTC(2026, 10, 8, 10, 20, 0),
    )
    expect(parseApiDate("2026-11-08 10:20:00.500")?.getTime()).toBe(
      Date.UTC(2026, 10, 8, 10, 20, 0, 500),
    )
  })

  it("无法识别的值返回 null，不静默假定一个时区", () => {
    expect(parseApiDate("")).toBeNull()
    expect(parseApiDate(undefined)).toBeNull()
    expect(parseApiDate("not-a-date")).toBeNull()
    expect(parseApiTime("not-a-date")).toBeNull()
  })

  it("纯日期按本地日历日解释，不因时区掉到前一天", () => {
    const date = parseApiDate("2026-11-08")
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(10)
    expect(date?.getDate()).toBe(8)
    expect(date?.getHours()).toBe(0)
  })
})

describe("跨日与分组", () => {
  it("UTC 16:30 在 Asia/Shanghai 已是第二天", () => {
    expect(dayKey("2026-11-08T16:30:00Z", SHANGHAI)).toBe("2026-11-09")
    expect(dayKey("2026-11-08T16:30:00Z", "UTC")).toBe("2026-11-08")
  })

  it("会话时间戳按给定本地日判断今天/昨天", () => {
    const now = new Date("2026-11-08T12:00:00+08:00")
    expect(formatSessionStamp("2026-11-08T09:30:00+08:00", { now, timeZone: SHANGHAI })).toBe(
      "今天 09:30",
    )
    expect(formatSessionStamp("2026-11-07T23:10:00+08:00", { now, timeZone: SHANGHAI })).toBe(
      "昨天 23:10",
    )
    expect(formatSessionStamp("2026-10-01T08:00:00+08:00", { now, timeZone: SHANGHAI })).toBe(
      "10-01",
    )
    expect(
      formatSessionStamp("2025-12-31T08:00:00+08:00", { now, timeZone: SHANGHAI }),
    ).toBe("2025-12-31")
  })

  it("旧格式的 10:20（UTC）在 Asia/Shanghai 显示为 18:20，并落在当天", () => {
    const now = new Date("2026-11-08T20:00:00+08:00")
    expect(yesterdayKey(now, SHANGHAI)).toBe("2026-11-07")
    expect(formatSessionStamp("2026-11-08 10:20:00", { now, timeZone: SHANGHAI })).toBe(
      "今天 18:20",
    )
  })
})

describe("formatLocalDateTime", () => {
  it("记录纸读数同样按时间点换算", () => {
    expect(formatLocalDateTime("2026-11-08T10:20:00Z", SHANGHAI)).toBe("2026-11-08 18:20")
    expect(formatLocalDateTime("2026-11-08 10:20:00", SHANGHAI)).toBe("2026-11-08 18:20")
  })
})
