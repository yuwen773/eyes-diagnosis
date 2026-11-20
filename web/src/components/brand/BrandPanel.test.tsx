// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { BrandPanel } from "./BrandPanel"

afterEach(cleanup)

describe("BrandPanel 材质变体", () => {
  it("默认落在 layered（Hero 信息卡最常见的用途）", () => {
    const { container } = render(<BrandPanel>内容</BrandPanel>)
    const panel = container.firstElementChild!
    expect(panel.className).toContain("brand-panel")
    expect(panel.className).toContain("brand-panel--layered")
  })

  it.each([
    ["layered", "brand-panel--layered"],
    ["glass", "brand-panel--glass"],
    ["frosted", "brand-panel--frosted"],
    ["soft", "brand-panel--soft"],
    ["solid", "brand-panel--solid"],
  ] as const)("variant=%s 输出 %s", (variant, cls) => {
    const { container } = render(<BrandPanel variant={variant}>内容</BrandPanel>)
    expect(container.firstElementChild!.className).toContain(cls)
  })

  it("实体面仍可换语义标签（页脚一类承载大量文字的区域）", () => {
    const { container } = render(
      <BrandPanel variant="solid" as="section">
        内容
      </BrandPanel>,
    )
    expect(container.querySelector("section.brand-panel--solid")).not.toBeNull()
  })
})
