import { describe, expect, it } from "vitest"
import {
  barLabelFits,
  canDeleteUser,
  confidencePercent,
  diagnosisFilterParams,
  formatStatNumber,
  formatStatPercent,
  humanReviewStatusLabel,
  knowledgeStatusView,
  newsContentValid,
  newsStatusOptionsFor,
  newsStatusView,
  rankDistribution,
  reviewView,
  userRoleView,
} from "./adminDomain"

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
  it("3 是待审核（后端 PENDING_REVIEW），不能再读成未知", () => {
    expect(newsStatusView(3)).toEqual({ label: "待审核", risk: "attention" })
  })
  it("缺省读「未知」而不是「草稿」——老数据没写状态不能冒充草稿", () => {
    expect(newsStatusView(undefined)).toEqual({ label: "未知", risk: "unknown" })
    expect(newsStatusView(null)).toEqual({ label: "未知", risk: "unknown" })
    expect(newsStatusView(9)).toEqual({ label: "未知", risk: "unknown" })
  })
})

describe("newsStatusOptionsFor", () => {
  it("草稿可保持草稿、提交待审核或直接发布", () => {
    expect(newsStatusOptionsFor(0).map((o) => o.value)).toEqual([0, 3, 1])
  })
  it("已发布只能下架或退回草稿，不能直接改回待审核", () => {
    expect(newsStatusOptionsFor(1).map((o) => o.value)).toEqual([0, 1, 2])
  })
  it("待审核可发布、驳回草稿或下架", () => {
    expect(newsStatusOptionsFor(3).map((o) => o.value)).toEqual([0, 3, 1, 2])
  })
  it("状态未知时返回全量，老数据仍可编辑", () => {
    expect(newsStatusOptionsFor(undefined).map((o) => o.value)).toEqual([0, 3, 1, 2])
    expect(newsStatusOptionsFor(9).map((o) => o.value)).toEqual([0, 3, 1, 2])
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

describe("userRoleView", () => {
  it("三档角色各归其位", () => {
    expect(userRoleView("admin").label).toBe("管理员")
    expect(userRoleView("user").label).toBe("普通用户")
    expect(userRoleView("ban").label).toBe("已封禁")
  })
  it("未知角色不猜成「普通用户」", () => {
    // 老数据里没写角色的账号，按「未标注」显示，而不是被显示成普通用户。
    expect(userRoleView(undefined).label).toBe("未标注")
    expect(userRoleView("").label).toBe("未标注")
    expect(userRoleView("root").label).toBe("root")
  })
})

describe("diagnosisFilterParams", () => {
  it("空筛选 = 不限", () => {
    expect(diagnosisFilterParams("")).toEqual({})
  })
  it("待人工复核 / AI 拒识 走各自的布尔列", () => {
    expect(diagnosisFilterParams("requiresReview")).toEqual({ requiresReview: true })
    expect(diagnosisFilterParams("aiRejected")).toEqual({ aiRejected: true })
  })
  it("已复审 / 复审中 / 未复审 走 reexamineStatus", () => {
    expect(diagnosisFilterParams("reviewed")).toEqual({ reexamineStatus: 3 })
    expect(diagnosisFilterParams("reviewing")).toEqual({ reexamineStatus: 2 })
    expect(diagnosisFilterParams("notReviewed")).toEqual({ reexamineStatus: 1 })
  })
})

describe("knowledgeStatusView", () => {
  it("0 处理中 / 1 已完成 / 2 失败", () => {
    expect(knowledgeStatusView(0).label).toBe("处理中")
    expect(knowledgeStatusView(1).label).toBe("已完成")
    expect(knowledgeStatusView(2).label).toBe("失败")
  })
  it("缺省读「未知」", () => {
    expect(knowledgeStatusView(undefined).label).toBe("未知")
  })
})

describe("humanReviewStatusLabel", () => {
  it("代码翻成人话", () => {
    expect(humanReviewStatusLabel("REVIEWED")).toBe("已复核")
    expect(humanReviewStatusLabel("AWAITING_REVIEW")).toBe("拒识 / 低置信 · 待复核")
    expect(humanReviewStatusLabel(null)).toBe("未记录")
  })
})

describe("formatStatNumber / formatStatPercent", () => {
  it("计数千分位", () => {
    expect(formatStatNumber(8452)).toBe("8,452")
    expect(formatStatNumber(0)).toBe("0")
  })
  it("非有限值给破折号", () => {
    expect(formatStatNumber(NaN)).toBe("—")
  })
  it("比例 → 一位小数百分比", () => {
    expect(formatStatPercent(0.874)).toBe("87.4%")
    expect(formatStatPercent(null)).toBe("—")
  })
})
