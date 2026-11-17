// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  canRequestReexamine,
  highRiskCell,
  loadServerStats,
  reexamineLabel,
  reexamineView,
  resolveScopedStats,
  statsLabels,
  summarizeRecords,
} from "./records"
import { ApiError, getMyStats } from "./api"
import type { DiagnosisManage } from "./api"

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>()
  return { ...actual, getMyStats: vi.fn() }
})

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
    // severe + moderate 是有分级的两条；拒识记录即便残留 severity 也不算。
    expect(stats.assessed).toBe(2)
  })

  it("全部 NOT_ASSESSED：assessed 为 0，highRisk 的 0 不代表医学结论", () => {
    const stats = summarizeRecords(
      [row({ severity: "NOT_ASSESSED" }), row({ severity: null })],
      2,
    )
    expect(stats.assessed).toBe(0)
    expect(stats.highRisk).toBe(0)
  })

  it("全部有有效分级：assessed 等于记录条数", () => {
    const stats = summarizeRecords(
      [row({ severity: "normal" }), row({ severity: "severe" }), row({ severity: "mild" })],
      3,
    )
    expect(stats.assessed).toBe(3)
    expect(stats.highRisk).toBe(1)
  })

  it("有分级与未评估混合：assessed 只数有分级的那部分", () => {
    const stats = summarizeRecords(
      [row({ severity: "severe" }), row({ severity: "NOT_ASSESSED" }), row({ severity: null })],
      3,
    )
    expect(stats.assessed).toBe(1)
    expect(stats.highRisk).toBe(1)
  })

  it("拒识记录的人工复核要求照常计入", () => {
    const stats = summarizeRecords([row({ aiRejected: true, requiresReview: true })], 1)
    expect(stats.awaitingReview).toBe(1)
    expect(stats.assessed).toBe(0)
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
    expect(stats).toEqual({
      total: 0,
      assessed: 0,
      highRisk: 0,
      awaitingReview: 0,
      lastReadAt: null,
      pageTotal: 0,
    })
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

const mockedStats = vi.mocked(getMyStats)

beforeEach(() => {
  mockedStats.mockReset()
})

describe("reexamineView", () => {
  it("复审中显示回执，重新打开也能看到", () => {
    expect(reexamineView(row({ reexamineStatus: 2 }), false)).toBe("receipt")
  })

  it("提交成功后的乐观态优先显示回执", () => {
    expect(reexamineView(row({ reexamineStatus: 2 }), true)).toBe("receipt")
  })

  it("未复审与已复审都显示可申请", () => {
    expect(reexamineView(row({ reexamineStatus: 1 }), false)).toBe("request")
    expect(reexamineView(row({ reexamineStatus: 3 }), false)).toBe("reviewed")
  })

  it("拒识或没有复审状态时不渲染整块", () => {
    expect(reexamineView(row({ aiRejected: true }), false)).toBeNull()
    expect(reexamineView(row({ reexamineStatus: undefined }), false)).toBeNull()
  })
})

describe("resolveScopedStats", () => {
  const serverStats = {
    total: 128,
    assessed: 128,
    highRisk: 9,
    awaitingReview: 12,
    lastReadAt: "2026-11-08 14:32:10",
  }

  it("服务端聚合可用时用全量口径", () => {
    expect(resolveScopedStats(serverStats, [row({ severity: "severe" })], 1)).toEqual({
      stats: serverStats,
      scope: "all",
    })
  })

  it("聚合不可用时退回当前页并标注 page", () => {
    const result = resolveScopedStats(null, [row({ severity: "severe" })], 37)
    expect(result.scope).toBe("page")
    expect(result.stats).toEqual({
      total: 37,
      assessed: 1,
      highRisk: 1,
      awaitingReview: 0,
      lastReadAt: "2026-11-01 10:00:00",
      // 本页只有 1 条：page 口径的高风险分母必须用它，不能用全量 37。
      pageTotal: 1,
    })
  })

  it("聚合与页面都没有数据时口径仍是 page，不冒充全量", () => {
    const result = resolveScopedStats(null, [], 0)
    expect(result.scope).toBe("page")
    expect(result.stats.total).toBe(0)
  })
})

describe("loadServerStats", () => {
  it("载荷齐全时原样返回", async () => {
    const payload = {
      total: 128,
      assessed: 128,
      highRisk: 9,
      awaitingReview: 12,
      lastReadAt: null,
    }
    mockedStats.mockResolvedValueOnce(payload as never)
    await expect(loadServerStats()).resolves.toEqual(payload)
  })

  it("接口未实现（404）时返回 null，不向上抛", async () => {
    mockedStats.mockRejectedValueOnce(new ApiError(404, "服务返回 404"))
    await expect(loadServerStats()).resolves.toBeNull()
  })

  it("网络错误同样返回 null", async () => {
    mockedStats.mockRejectedValueOnce(new ApiError(-1, "网络不可用"))
    await expect(loadServerStats()).resolves.toBeNull()
  })

  it("服务端返回空对象时返回 null（不冒充全量）", async () => {
    mockedStats.mockResolvedValueOnce({} as never)
    await expect(loadServerStats()).resolves.toBeNull()
  })

  it("服务端返回 null 时返回 null", async () => {
    mockedStats.mockResolvedValueOnce(null as never)
    await expect(loadServerStats()).resolves.toBeNull()
  })

  it("字段缺一（缺 highRisk）时返回 null", async () => {
    mockedStats.mockResolvedValueOnce({
      total: 128,
      assessed: 128,
      awaitingReview: 12,
      lastReadAt: null,
    } as never)
    await expect(loadServerStats()).resolves.toBeNull()
  })

  it("缺 assessed 时返回 null：没有分级覆盖数据，0 条高风险无法与未评估区分", async () => {
    mockedStats.mockResolvedValueOnce({
      total: 128,
      highRisk: 0,
      awaitingReview: 12,
      lastReadAt: null,
    } as never)
    await expect(loadServerStats()).resolves.toBeNull()
  })

  it("数值字段不是有限数字时返回 null", async () => {
    mockedStats.mockResolvedValueOnce({
      total: "128",
      assessed: 128,
      highRisk: 9,
      awaitingReview: 12,
      lastReadAt: null,
    } as never)
    await expect(loadServerStats()).resolves.toBeNull()
  })
})

describe("statsLabels", () => {
  it("全量口径不带「本页」", () => {
    expect(statsLabels("all")).toEqual({
      total: "判读总数 · TOTAL",
      awaitingReview: "待人工复核 · REVIEW",
      lastReadAt: "最近判读 · LAST",
    })
  })

  it("本页口径必须写明「本页」", () => {
    expect(statsLabels("page")).toEqual({
      total: "判读总数 · TOTAL",
      awaitingReview: "本页待人工复核 · REVIEW",
      lastReadAt: "本页最近 · LAST",
    })
  })
})

describe("highRiskCell：未知与零必须分开", () => {
  const base = { total: 10, assessed: 0, highRisk: 0, awaitingReview: 0, lastReadAt: null }

  it("全部未评估：显示「未评估」，不显示 0", () => {
    const cell = highRiskCell(base, "page")
    expect(cell.unknown).toBe(true)
    expect(cell.value).toBe("未评估")
    expect(cell.label).toBe("本页严重度 · 未评估")
    expect(cell.note).toContain("暂不可用")
  })

  it("全量口径同样标明未评估", () => {
    const cell = highRiskCell({ ...base, total: 128 }, "all")
    expect(cell.value).toBe("未评估")
    expect(cell.label).toBe("严重度 · 未评估")
  })

  it("全部有分级：读数就是真实条数", () => {
    const cell = highRiskCell({ ...base, assessed: 10, highRisk: 3 }, "all")
    expect(cell).toEqual({ label: "高风险 · SEVERE", value: "3", note: null, unknown: false })
  })

  it("部分有分级：口径写明已分级多少条", () => {
    const cell = highRiskCell({ ...base, assessed: 4, highRisk: 2 }, "page")
    expect(cell.label).toBe("本页高风险 · 已分级 4/10")
    expect(cell.value).toBe("2")
    expect(cell.note).toContain("4 条")
    expect(cell.unknown).toBe(false)
  })

  it("个人中心用样本口径前缀，不冒充「本页」", () => {
    const cell = highRiskCell(base, "page", "近 5 条")
    expect(cell.label).toBe("近 5 条严重度 · 未评估")
  })

  it("page 口径的分母用本页条数，不拿本页分子配全量分母", () => {
    // total=57 是名下全量，assessed=3 只数到本页；分母必须也是本页的 5。
    const cell = highRiskCell({ ...base, total: 57, pageTotal: 5, assessed: 3, highRisk: 1 }, "page")
    expect(cell.label).toBe("本页高风险 · 已分级 3/5")
    expect(cell.note).toContain("3 条")
  })

  it("all 口径忽略本页条数，分母是服务端全量", () => {
    const cell = highRiskCell({ ...base, total: 57, pageTotal: 5, assessed: 3, highRisk: 1 }, "all")
    expect(cell.label).toBe("高风险 · 已分级 3/57")
  })
})
