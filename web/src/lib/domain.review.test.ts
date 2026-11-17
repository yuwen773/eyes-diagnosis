import { describe, expect, it } from "vitest"
import { reviewState } from "./domain"

/**
 * 回归：后端写的是 HumanReviewStatus 的五个值，早期前端只认
 * APPROVED / REJECTED / PENDING，导致**已复核的记录仍显示“待复核”**。
 * 这里把两套枚举都钉住，防止再收窄。
 */
describe("reviewState 覆盖后端真实枚举", () => {
  it.each([
    ["REVIEWED", "已复核", "normal"],
    ["OVERRIDDEN", "已人工改判", "normal"],
    ["AWAITING_REVIEW", "待复核", "attention"],
    ["AI_ONLY", "待复核", "attention"],
    ["PENDING_AI", "待复核", "attention"],
  ] as const)("%s → %s", (status, label, risk) => {
    expect(reviewState(status)).toEqual({ label, risk })
  })

  it.each([
    ["APPROVED", "已复核", "normal"],
    ["REJECTED", "已退回", "critical"],
    ["PENDING", "待复核", "attention"],
  ] as const)("旧枚举 %s 仍然可读 → %s", (status, label, risk) => {
    expect(reviewState(status)).toEqual({ label, risk })
  })

  it("未知状态保守落“待复核”，不冒充已复核", () => {
    expect(reviewState("WHATEVER")).toEqual({ label: "待复核", risk: "attention" })
    expect(reviewState(undefined)).toEqual({ label: "待复核", risk: "attention" })
  })
})
