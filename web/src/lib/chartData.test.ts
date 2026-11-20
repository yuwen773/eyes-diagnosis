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
  it("柱值是每个星期几的日均，不是窗口累计", () => {
    const trend = [
      { day: "2026-11-02", value: 2 }, // 周一
      { day: "2026-11-09", value: 4 }, // 周一
      { day: "2026-11-10", value: 3 }, // 周二
    ]
    const result = weekdayBreakdown(trend, 30)

    expect(result.total).toBe(9)
    expect(result.average).toBeCloseTo(9 / 30, 10)
    expect(result.bars[0]).toEqual({
      label: "周一",
      total: 6,
      occurrences: 2,
      average: 3,
    })
    expect(result.bars[1]).toEqual({
      label: "周二",
      total: 3,
      occurrences: 1,
      average: 3,
    })
  })

  it("出现次数不同时，累计值会误导，日均才是可比的", () => {
    // 周一出现 2 次共 4 人，周二出现 1 次共 2 人：累计是 2:1，
    // 但两天的活跃度完全一样（都是每天 2 人）。
    const trend = [
      { day: "2026-11-02", value: 2 },
      { day: "2026-11-09", value: 2 },
      { day: "2026-11-10", value: 2 },
    ]
    const result = weekdayBreakdown(trend, 30)

    expect(result.bars[0].total).toBe(4)
    expect(result.bars[1].total).toBe(2)
    expect(result.bars[0].average).toBe(2)
    expect(result.bars[1].average).toBe(2)
  })

  it("窗口里没出现过的星期几，日均是 0 而不是空", () => {
    const result = weekdayBreakdown([{ day: "2026-11-09", value: 5 }], 7)
    expect(result.bars[6]).toEqual({
      label: "周日",
      total: 0,
      occurrences: 0,
      average: 0,
    })
  })

  it("非法日期不计入", () => {
    const result = weekdayBreakdown([{ day: "不是日期", value: 5 }], 30)
    expect(result.total).toBe(0)
    expect(result.bars.every((bar) => bar.occurrences === 0)).toBe(true)
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
