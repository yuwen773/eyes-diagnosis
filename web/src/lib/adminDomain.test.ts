import { describe, expect, it } from "vitest"
import { barLabelFits, canDeleteUser, confidencePercent, newsContentValid, newsStatusView, rankDistribution, reviewView } from "./adminDomain"

describe("reviewView", () => {
  it("aiRejected 优先于一切", () => {
    expect(reviewView({ reexamineStatus: 3, requiresReview: true, aiRejected: true })).toEqual({
      label: "AI 拒识", risk: "critical", tone: "ai",
    })
  })
  it("requiresReview 次之", () => {
    expect(reviewView({ reexamineStatus: 1, requiresReview: true, aiRejected: false }).label).toBe("待人工复核")
  })
  it("reexamineStatus 1/2/3/缺省", () => {
    expect(reviewView({ reexamineStatus: 1, requiresReview: false, aiRejected: false }).label).toBe("未复审")
    expect(reviewView({ reexamineStatus: 2, requiresReview: false, aiRejected: false }).label).toBe("复审中")
    expect(reviewView({ reexamineStatus: 3, requiresReview: false, aiRejected: false })).toEqual({
      label: "已复审", risk: "normal", tone: "plain",
    })
    expect(reviewView({ requiresReview: false, aiRejected: false }).label).toBe("未复审")
  })
})

describe("canDeleteUser", () => {
  it("目标是 admin → 不给删", () => {
    expect(canDeleteUser({ id: "1", userRole: "admin" })).toBe(false)
  })
  it("目标是普通用户 → 可删", () => {
    expect(canDeleteUser({ id: "2", userRole: "user" })).toBe(true)
  })
  it("目标缺失 → 不给删", () => {
    expect(canDeleteUser(null)).toBe(false)
    expect(canDeleteUser(undefined)).toBe(false)
  })
})

describe("newsStatusView", () => {
  it("0/1/2 映射后端语义：草稿 / 已发布 / 已下架", () => {
    expect(newsStatusView(0)).toEqual({ label: "草稿", risk: "attention" })
    expect(newsStatusView(1)).toEqual({ label: "已发布", risk: "normal" })
    expect(newsStatusView(2)).toEqual({ label: "已下架", risk: "critical" })
  })
  it("缺省读「未知」而不是「草稿」——老数据没写状态不能冒充草稿", () => {
    expect(newsStatusView(undefined)).toEqual({ label: "未知", risk: "unknown" })
    expect(newsStatusView(null)).toEqual({ label: "未知", risk: "unknown" })
    expect(newsStatusView(9)).toEqual({ label: "未知", risk: "unknown" })
  })
})

describe("newsContentValid", () => {
  it("29 字拦 / 30 字放", () => {
    expect(newsContentValid("字".repeat(29))).toBe(false)
    expect(newsContentValid("字".repeat(30))).toBe(true)
  })
  it("不 trim——29 字加空白仍拦", () => {
    expect(newsContentValid("字".repeat(29) + "  ")).toBe(false)
  })
})

describe("rankDistribution", () => {
  it("降序 + 占比", () => {
    const rows = rankDistribution([
      { name: "白内障", value: 484 },
      { name: "正常", value: 1048 },
      { name: "青光眼", value: 300 },
    ])
    expect(rows[0].name).toBe("正常")
    expect(rows[0].share).toBeCloseTo(1048 / 1832, 5)
    expect(rows[2].name).toBe("青光眼")
  })
  it("total 0 → share 全 0，不产生 NaN", () => {
    expect(rankDistribution([{ name: "A", value: 0 }])[0].share).toBe(0)
  })
})

describe("barLabelFits", () => {
  it("长名窄条放不下", () => {
    expect(barLabelFits(60, "高血压性视网膜病变")).toBe(false)
  })
  it("短名宽条放得下", () => {
    expect(barLabelFits(400, "正常")).toBe(true)
  })
})

describe("confidencePercent", () => {
  it("0–1 概率形态 → 百分比", () => {
    expect(confidencePercent(0.87)).toBe("87.0%")
  })
  it("0–100 百分数形态 → 同一个读数", () => {
    expect(confidencePercent(87)).toBe("87.0%")
  })
  it("null（AI 拒识，后端置空）→ 「—」，不是 0.0%", () => {
    expect(confidencePercent(null)).toBe("—")
  })
  it("undefined / NaN → 「—」", () => {
    expect(confidencePercent(undefined)).toBe("—")
    expect(confidencePercent(NaN)).toBe("—")
  })
})
