// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render } from "@testing-library/react"

import { TurnActions } from "./TurnActions"

afterEach(() => {
  cleanup()
})

describe("TurnActions", () => {
  it("只有一轮回答且不能重新生成时什么都不渲染（不做点不动的装饰）", () => {
    const { container } = render(
      <TurnActions variantIds={["v1"]} selectedVariantId="v1" canRegenerate={false} busy={false} />,
    )
    expect(container.querySelector(".agent-turnbar")).toBeNull()
  })

  it("多版本时显示当前序号，切换按生成顺序循环", () => {
    const onSelect = vi.fn()
    const { container, getByLabelText } = render(
      <TurnActions
        variantIds={["v1", "v2", "v3"]}
        selectedVariantId="v2"
        canRegenerate={false}
        busy={false}
        onSelectVariant={onSelect}
      />,
    )
    expect(container.querySelector(".agent-turnbar__count")?.textContent).toBe("2/3")
    fireEvent.click(getByLabelText("下一版回答"))
    expect(onSelect).toHaveBeenLastCalledWith("v3")
    fireEvent.click(getByLabelText("上一版回答"))
    expect(onSelect).toHaveBeenLastCalledWith("v1")
  })

  it("选中版本不在列表里（旧数据/并发）时按最后一份显示，不假装选中", () => {
    const { container } = render(
      <TurnActions variantIds={["v1", "v2"]} selectedVariantId={null} canRegenerate={false} busy={false} />,
    )
    expect(container.querySelector(".agent-turnbar__count")?.textContent).toBe("2/2")
  })

  it("重新生成在流式期间不可点", () => {
    const onRegenerate = vi.fn()
    const { getByText } = render(
      <TurnActions canRegenerate busy onRegenerate={onRegenerate} />,
    )
    const button = getByText("重新生成").closest("button") as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onRegenerate).not.toHaveBeenCalled()
  })

  it("点击重新生成交给调用方；提示说明旧版本会保留", () => {
    const onRegenerate = vi.fn()
    const { getByText } = render(
      <TurnActions canRegenerate busy={false} onRegenerate={onRegenerate} />,
    )
    const button = getByText("重新生成").closest("button") as HTMLButtonElement
    expect(button.title).toContain("旧版本会保留")
    fireEvent.click(button)
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })
})
