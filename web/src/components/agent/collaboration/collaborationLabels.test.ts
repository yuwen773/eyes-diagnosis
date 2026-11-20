import { expect, it } from "vitest"
import { summaryLabel } from "./collaborationLabels"

it("distinguishes no objections, rewrite, supplement and unknown critic actions", () => {
  expect(summaryLabel("CRITIC_NONE", 0)).toBe("安全复核未提出异议 · 质疑 0 条")
  expect(summaryLabel("CRITIC_REWRITE", 1)).toContain("要求修订")
  expect(summaryLabel("CRITIC_SUPPLEMENT", 2)).toContain("要求补充证据")
  expect(summaryLabel("CRITIC_FUTURE_ACTION", 0)).toBe("角色阶段事实已记录")
})
