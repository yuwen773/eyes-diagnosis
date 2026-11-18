import { describe, expect, it } from "vitest"
import { humanReviewState } from "./domain"

/**
 * 回归：后端 HumanReviewStatus 只有五个值，而且这五个值不是同一件事的强弱档。
 *
 * - AI_ONLY = **没进复核队列**，不能写成「待复核」——那是替系统承诺一件没发生的事；
 * - AWAITING_REVIEW 才是真的进了队列；
 * - REVIEWED 只说明有人复核过，不说明那个人是医生（D-01b，角色看 source.reviewerRole）。
 */
describe("humanReviewState 覆盖后端真实枚举", () => {
  it.each([
    ["PENDING_AI", "待模型出结论", "unknown"],
    ["AI_ONLY", "仅 AI 结论 · 未进入复核队列", "unknown"],
    ["AWAITING_REVIEW", "已进入复核队列 · 待复核", "attention"],
    ["REVIEWED", "人工复核已记录", "normal"],
    ["OVERRIDDEN", "人工结论已推翻 AI", "attention"],
  ] as const)("%s → %s", (status, label, risk) => {
    expect(humanReviewState(status)).toEqual({ label, risk })
  })

  it("两条不能互相冒充：AI_ONLY 不读作待复核，REVIEWED 不读作医生复核", () => {
    expect(humanReviewState("AI_ONLY").label).not.toContain("待复核")
    expect(humanReviewState("REVIEWED").label).not.toContain("医生")
  })

  it("旧枚举（APPROVED / REJECTED / PENDING）后端已不再写入，不再特殊处理", () => {
    // 保留这条是为了让「以前认、现在不认」这件事在 diff 里可见，而不是悄悄改语义。
    for (const legacy of ["APPROVED", "REJECTED", "PENDING"]) {
      expect(humanReviewState(legacy)).toEqual({ label: "未记录", risk: "unknown" })
    }
  })

  it("未知 / 缺失状态落「未记录」，不冒充任何一档", () => {
    expect(humanReviewState("WHATEVER")).toEqual({ label: "未记录", risk: "unknown" })
    expect(humanReviewState(undefined)).toEqual({ label: "未记录", risk: "unknown" })
    expect(humanReviewState(null)).toEqual({ label: "未记录", risk: "unknown" })
  })
})
