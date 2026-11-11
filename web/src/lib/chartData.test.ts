import { describe, expect, it } from "vitest"

import {
  alignPreviousWindow,
  changeLabel,
  dayLabel,
  pctChange,
  sharedDomainMax,
  weekdayBreakdown,
} from "./chartData"

/**
 * 图表整形的口径。
 *
 * 三条最容易出错的地方：
 * 1. 两个窗口按天对齐——对错了，环比就是拿今天比上个月；
 * 2. 按星期分布的主读数是「合计」——写成最后一根柱子的值会误导；
 * 3. 上期为 0 时不���除零。
 */
describe("alignPreviousWindow", () => {
  it("把上一窗口按天对齐到当前窗口", () => {
    const rows = alignPreviousWindow(
      ["2026-11-10", "2026-11-11"],
      [
        { day: "2026-11-10", value: 3 },
        { day: "2026-11-11", value: 5 },
      ],
      [
        { day: "2026-11-03", value: 1 },
        { day: "2026-11-04", value: 2 },
      ],
    )
    expect(rows).toEqual([
      { day: "2026-11-10", label: "11-10", value: 3, previous: 1 },
      { day: "2026-11-11", label: "11-11", value: 5, previous: 2 },
    ])
  })

  it("缺项按 0 处理，不留空洞", () => {
    const rows = alignPreviousWindow(
      ["2026-11-10", "2026-11-11"],
      [{ day: "2026-11-10", value: 3 }],
      [],
    )
    expect(rows[1].value).toBe(0)
    expect(rows[1].previous).toBe(0)
  })
})

describe("dayLabel", () => {
  it("只留月-日", () => {
    expect(dayLabel("2026-11-01")).toBe("11-01")
    expect(dayLabel("11-01")).toBe("11-01")
  })
})

describe("weekdayBreakdown", () => {
  it("合计是窗口内总量，日均按 7 天分摊", () => {
    const trend = [
      { day: "2026-11-09", value: 2 }, // 周一
      { day: "2026-11-10", value: 3 }, // 周二
      { day: "2026-11-10", value: 1 }, // 同一天再计一次（防御性）
    ]
    const result = weekdayBreakdown(trend, 7)
    expect(result.total).toBe(6)
    expect(result.average).toBeCloseTo(6 / 7, 10)
    expect(result.bars[0]).toEqual({ label: "周一", value: 2 })
    expect(result.bars[1]).toEqual({ label: "周二", value: 4 })
  })

  it("日均按窗口天数摊，不是按 7 天摊", () => {
    const trend = [
      { day: "2026-11-02", value: 6 },
      { day: "2026-11-09", value: 4 },
    ]
    const result = weekdayBreakdown(trend, 30)
    expect(result.total).toBe(10)
    expect(result.average).toBeCloseTo(10 / 30, 10)
  })

  it("非法日期不计入", () => {
    const result = weekdayBreakdown([{ day: "不是日期", value: 5 }], 30)
    expect(result.total).toBe(0)
  })
})

describe("pctChange / changeLabel", () => {
  it("上期为 0 时没有可比基数", () => {
    expect(pctChange(10, 0)).toBeNull()
    expect(changeLabel(10, 0)).toBe("上期为 0")
  })

  it("给出带符号的环比", () => {
    expect(pctChange(110, 100)).toBeCloseTo(0.1, 10)
    expect(changeLabel(110, 100)).toBe("较上期 +10.0%")
    expect(changeLabel(90, 100)).toBe("较上期 -10.0%")
  })
})

describe("sharedDomainMax", () => {
  it("取所有系列里的最大值，保证小倍数同尺度", () => {
    expect(sharedDomainMax([[1, 2], [3, 10], [4]])).toBe(10)
  })

  it("全空时给 1，避免除零", () => {
    expect(sharedDomainMax([[], []])).toBe(1)
  })
})
