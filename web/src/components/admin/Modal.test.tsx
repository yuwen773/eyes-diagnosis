// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { Modal } from "./Modal"

afterEach(() => {
  cleanup()
})

describe("Modal 弹层语义", () => {
  it("打开时通过 Portal 挂到 body，并提供 dialog 名称", () => {
    render(
      <Modal open title="人工复核" onClose={() => {}}>
        <p>结论</p>
      </Modal>,
    )

    const dialog = screen.getByRole("dialog", { name: "人工复核" })
    expect(document.body.contains(dialog)).toBe(true)
    expect(screen.getByText("结论")).toBeTruthy()
  })

  it("关闭时不渲染弹层", () => {
    render(
      <Modal open={false} title="人工复核" onClose={() => {}}>
        <p>结论</p>
      </Modal>,
    )

    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("Esc 交给 onClose，由父级决定是否关闭", async () => {
    const onClose = vi.fn()
    render(
      <Modal open title="人工复核" onClose={onClose}>
        <p>结论</p>
      </Modal>,
    )

    fireEvent.keyDown(document, { key: "Escape" })

    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
