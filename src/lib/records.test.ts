// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { canRequestReexamine, reexamineLabel, summarizeRecords } from "./records"
import type { DiagnosisManage } from "./api"

function row(overrides: Partial<DiagnosisManage> = {}): DiagnosisManage {
  return {
    id: "1",
    result: "正常",
    severity: "normal",
    reexamineStatus: 1,
    createTime: "2026-11-01 10:00:00",
    ...overrides,
  }
}

describe("reexamineLabel", () => {
  it("三种复审状态各有文案", () => {
    expect(reexamineLabel(1)).toBe("未复审")
    expect(reexamineLabel(2)).toBe("复审中")
    expect(reexamineLabel(3)).toBe("已复审")
  })

  it("缺省按未复审处理", () => {
    expect(reexamineLabel(undefined)).toBe("未复审")
  })
})

describe("summarizeRecords", () => {
  it("total 取信封值而不是数 records", () => {
    const stats = summarizeRecords([row(), row()], 37)
    expect(stats.total).toBe(37)
  })

  it("高风险只数未拒识且 severity=severe 的记录", () => {
    const stats = summarizeRecords(
      [
        row({ severity: "severe" }),
        row({ severity: "severe", aiRejected: true }),
        row({ severity: "moderate" }),
        row({ aiRejected: true }),
      ],
      4,
    )
    expect(stats.highRisk).toBe(1)
  })

  it("待复核数 requiresReview 为真的记录", () => {
    const stats = summarizeRecords([row({ requiresReview: true }), row()], 2)
    expect(stats.awaitingReview).toBe(1)
  })

  it("最近判读时间取 createTime 的最大值", () => {
    const stats = summarizeRecords(
      [row({ createTime: "2026-11-01 10:00:00" }), row({ createTime: "2026-11-08 09:30:00" })],
      2,
    )
    expect(stats.lastReadAt).toBe("2026-11-08 09:30:00")
  })

  it("空列表：总数照传、时间与计数归零", () => {
    const stats = summarizeRecords([], 0)
    expect(stats).toEqual({ total: 0, highRisk: 0, awaitingReview: 0, lastReadAt: null })
  })
})

describe("canRequestReexamine", () => {
  it("未复审与已复审都可申请", () => {
    expect(canRequestReexamine(row({ reexamineStatus: 1 }))).toBe(true)
    expect(canRequestReexamine(row({ reexamineStatus: 3 }))).toBe(true)
  })

  it("复审中不可重复申请", () => {
    expect(canRequestReexamine(row({ reexamineStatus: 2 }))).toBe(false)
  })

  it("拒识记录没有可复核的结论，不给申请", () => {
    expect(canRequestReexamine(row({ aiRejected: true }))).toBe(false)
  })
})
