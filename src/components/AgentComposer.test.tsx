// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { AgentComposer } from "@/components/AgentComposer"
import { loadDraft } from "@/lib/agentDraft"

// jsdom 没有 WebGL：让 canvas 取上下文时静默返回 null，ElectricBorder 自己会降级
HTMLCanvasElement.prototype.getContext = (() =>
  null) as typeof HTMLCanvasElement.prototype.getContext

const session = { status: "anon" as "anon" | "authed" | "loading" }
vi.mock("@/lib/session", () => ({
  useSession: () => session,
}))

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

function setup() {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<AgentComposer dark={false} />} />
        <Route path="/agent" element={<div>agent-page</div>} />
      </Routes>
    </MemoryRouter>,
  )
  return screen.getByPlaceholderText(/描述症状/) as HTMLTextAreaElement
}

describe("AgentComposer", () => {
  it("Enter 提交：把文字存进草稿并跳到 Agent 页", () => {
    const textarea = setup()
    fireEvent.change(textarea, { target: { value: "右眼这两周看东西发暗" } })
    fireEvent.keyDown(textarea, { key: "Enter" })

    expect(loadDraft()).toBe("右眼这两周看东西发暗")
    expect(screen.getByText("agent-page")).toBeTruthy()
  })

  it("空输入按 Enter 不跳转", () => {
    const textarea = setup()
    fireEvent.keyDown(textarea, { key: "Enter" })

    expect(screen.queryByText("agent-page")).toBeNull()
  })

  it("Shift+Enter 换行不提交", () => {
    const textarea = setup()
    fireEvent.change(textarea, { target: { value: "第一行" } })
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true })

    expect(screen.queryByText("agent-page")).toBeNull()
  })

  it("中文输入法组字中的 Enter 不提交", () => {
    const textarea = setup()
    fireEvent.change(textarea, { target: { value: "你好" } })
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true })

    expect(screen.queryByText("agent-page")).toBeNull()
  })

  it("点附件按钮直接去 Agent 页上传图片", () => {
    setup()
    fireEvent.click(screen.getByRole("button", { name: "添加图片" }))

    expect(screen.getByText("agent-page")).toBeTruthy()
  })

  it("带着已输入的文字点附件：先存草稿再去 Agent 页", () => {
    const textarea = setup()
    fireEvent.change(textarea, { target: { value: "右眼这两周看东西发暗" } })
    fireEvent.click(screen.getByRole("button", { name: "添加图片" }))

    expect(loadDraft()).toBe("右眼这两周看东西发暗")
    expect(screen.getByText("agent-page")).toBeTruthy()
  })

  it("粘贴图片时提示到 Agent 页上传", () => {
    const textarea = setup()
    const file = new File(["x"], "a.png", { type: "image/png" })
    fireEvent.paste(textarea, { clipboardData: { files: [file] } })

    expect(screen.getByText(/图片请在 Agent 页上传/)).toBeTruthy()
  })
})
