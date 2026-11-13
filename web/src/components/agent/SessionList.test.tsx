// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { SessionList } from "@/components/agent/SessionList"
import type { AgentSessionVO } from "@/lib/api"

afterEach(() => {
  cleanup()
})

function session(id: string, title: string, updatedTime: string, isPinned?: boolean): AgentSessionVO {
  return {
    sessionId: id,
    title,
    lastMessage: "",
    messageCount: 1,
    summaryContent: "",
    createdTime: updatedTime,
    updatedTime,
    isPinned,
  }
}

/** 今天的本地零点，保证会话落进「今天」分组。 */
function todayIso() {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} 09:00:00`
}

function setup(sessions: AgentSessionVO[]) {
  const handlers = {
    onNewChat: vi.fn(),
    onSelect: vi.fn(),
    onRename: vi.fn().mockResolvedValue(true),
    onDelete: vi.fn().mockResolvedValue(true),
    onBatchDelete: vi.fn().mockResolvedValue(true),
    onTogglePin: vi.fn(),
    onExport: vi.fn(),
    onCollapse: vi.fn(),
  }
  render(
    <SessionList sessions={sessions} activeId="" busy={false} {...handlers} />,
  )
  return handlers
}

/** 打开某一行（按标题）的操作菜单。 */
function openMenu(title: string) {
  const row = screen.getByText(title).closest("li") as HTMLElement
  fireEvent.click(row.querySelector(".agent-session__menu-btn") as HTMLElement)
}

describe("SessionList 置顶", () => {
  it("置顶的会话进「置顶」分组，不留在「今天」分组里", () => {
    setup([
      session("s1", "普通会话", todayIso()),
      session("s2", "钉住的会话", todayIso(), true),
    ])

    const labels = Array.from(document.querySelectorAll(".agent-sessions__label")).map(
      (el) => el.textContent,
    )
    expect(labels).toContain("置顶")
    expect(labels).toContain("今天")

    // 「置顶」分组里只有被钉住的那条
    const pinnedSection = Array.from(document.querySelectorAll("section")).find(
      (el) => el.querySelector(".agent-sessions__label")?.textContent === "置顶",
    ) as HTMLElement
    expect(pinnedSection.textContent).toContain("钉住的会话")
    expect(pinnedSection.textContent).not.toContain("普通会话")
  })

  it("已置顶的会话菜单显示「取消置顶」，未置顶的显示「置顶」", () => {
    setup([
      session("s1", "普通会话", todayIso()),
      session("s2", "钉住的会话", todayIso(), true),
    ])

    openMenu("钉住的会话")
    expect(screen.getByText("取消置顶")).toBeTruthy()

    cleanup()
    setup([session("s1", "普通会话", todayIso())])
    openMenu("普通会话")
    expect(screen.getByText("置顶")).toBeTruthy()
  })

  it("点「取消置顶」把 isPinned=false 抛给页面", () => {
    const { onTogglePin } = setup([session("s2", "钉住的会话", todayIso(), true)])

    openMenu("钉住的会话")
    fireEvent.click(screen.getByText("取消置顶"))

    expect(onTogglePin).toHaveBeenCalledWith("s2", false)
  })
})

describe("SessionList 行级操作菜单", () => {
  it("导出提供 Markdown 和 JSON 两种明确选择", () => {
    const { onExport } = setup([session("s1", "会话 A", todayIso())])

    openMenu("会话 A")
    fireEvent.click(screen.getByRole("menuitem", { name: /导出 Markdown/ }))
    expect(onExport).toHaveBeenCalledWith("s1", "markdown")

    openMenu("会话 A")
    fireEvent.click(screen.getByRole("menuitem", { name: /导出 JSON/ }))
    expect(onExport).toHaveBeenCalledWith("s1", "json")
  })

  it("菜单项都有文字与图标，键盘方向键可移动、Esc 收回焦点", async () => {
    setup([session("s1", "会话 A", todayIso())])
    const row = screen.getByText("会话 A").closest("li") as HTMLElement
    const trigger = row.querySelector(".agent-session__menu-btn") as HTMLElement

    trigger.focus()
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    const menu = await screen.findByRole("menu")
    expect(within(menu).getAllByRole("menuitem").length).toBeGreaterThanOrEqual(5)
    // 每个条目都有图标（不能只靠颜色/文字其中一种通道）。
    expect(menu.querySelectorAll(".agent-session__menu-icon").length).toBeGreaterThanOrEqual(5)

    fireEvent.keyDown(document, { key: "Escape" })
    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull()
      expect(document.activeElement).toBe(trigger)
    })
  })
})

describe("SessionList 删除", () => {
  it("用 Dialog 确认单条删除，成功后关闭确认框", async () => {
    const { onDelete } = setup([session("s1", "会话 A", todayIso())])

    openMenu("会话 A")
    fireEvent.click(screen.getByRole("menuitem", { name: /删除/ }))

    const dialog = await screen.findByRole("dialog", { name: "删除会话" })
    expect(within(dialog).getByText(/「会话 A」/)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("s1"))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("删除失败时保留会话与确认框，并给出失败说明", async () => {
    const { onDelete } = setup([session("s1", "会话 A", todayIso())])
    onDelete.mockResolvedValue(false)

    openMenu("会话 A")
    fireEvent.click(screen.getByRole("menuitem", { name: /删除/ }))
    const dialog = await screen.findByRole("dialog", { name: "删除会话" })
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }))

    expect(await within(dialog).findByRole("alert")).toBeTruthy()
    expect(within(dialog).getByRole("alert").textContent).toContain("仍然保留")
    // 会话还在列表里，确认框也没被假装关掉。
    expect(screen.getByText("会话 A")).toBeTruthy()
    expect(screen.getByRole("dialog", { name: "删除会话" })).toBeTruthy()
  })

  it("删除中禁用重复提交", async () => {
    const { onDelete } = setup([session("s1", "会话 A", todayIso())])
    let resolve!: (value: boolean) => void
    onDelete.mockImplementation(() => new Promise((r) => (resolve = r)))

    openMenu("会话 A")
    fireEvent.click(screen.getByRole("menuitem", { name: /删除/ }))
    const dialog = await screen.findByRole("dialog", { name: "删除会话" })
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }))

    const pending = await within(dialog).findByRole("button", { name: "删除中…" })
    expect((pending as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(pending)
    expect(onDelete).toHaveBeenCalledTimes(1)

    resolve(true)
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })
})

describe("SessionList 批量删除", () => {
  function enterSelectMode() {
    fireEvent.click(screen.getByRole("button", { name: "选择" }))
  }

  it("只删除真实勾选项，成功后清理选择并退出多选", async () => {
    const { onBatchDelete } = setup([
      session("s1", "会话 A", todayIso()),
      session("s2", "会话 B", todayIso()),
      session("s3", "会话 C", todayIso()),
    ])

    enterSelectMode()
    fireEvent.click(screen.getByRole("checkbox", { name: /会话 A/ }))
    fireEvent.click(screen.getByRole("checkbox", { name: /会话 C/ }))
    expect(screen.getByText("已选 2")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /删除$/ }))
    const dialog = await screen.findByRole("dialog", { name: "批量删除会话" })
    expect(within(dialog).getByText(/选中的 2 个会话/)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole("button", { name: "删除 2" }))
    await waitFor(() => expect(onBatchDelete).toHaveBeenCalledWith(["s1", "s3"]))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    // 成功后才退出多选。
    expect(screen.queryByText(/已选/)).toBeNull()
    expect(screen.getByRole("button", { name: "选择" })).toBeTruthy()
  })

  it("批量删除失败时保留选择状态", async () => {
    const { onBatchDelete } = setup([
      session("s1", "会话 A", todayIso()),
      session("s2", "会话 B", todayIso()),
    ])
    onBatchDelete.mockResolvedValue(false)

    enterSelectMode()
    fireEvent.click(screen.getByRole("checkbox", { name: /会话 A/ }))
    fireEvent.click(screen.getByRole("button", { name: /删除$/ }))
    const dialog = await screen.findByRole("dialog", { name: "批量删除会话" })
    fireEvent.click(within(dialog).getByRole("button", { name: "删除 1" }))

    expect(await within(dialog).findByRole("alert")).toBeTruthy()
    // 关掉确认框后，选择没有丢，多选态还在。
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.getByText("已选 1")).toBeTruthy()
    expect((screen.getByRole("checkbox", { name: /会话 A/ }) as HTMLInputElement).checked).toBe(true)
  })
})

describe("SessionList 重命名", () => {
  it("Enter 提交，成功后退出编辑", async () => {
    const { onRename } = setup([session("s1", "会话 A", todayIso())])

    openMenu("会话 A")
    fireEvent.click(screen.getByRole("menuitem", { name: /重命名/ }))
    const input = screen.getByRole("textbox", { name: "会话标题" }) as HTMLInputElement
    fireEvent.change(input, { target: { value: "  新标题  " } })
    fireEvent.keyDown(input, { key: "Enter" })

    await waitFor(() => expect(onRename).toHaveBeenCalledWith("s1", "新标题"))
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "会话标题" })).toBeNull())
  })

  it("Escape 取消，不调用重命名接口", () => {
    const { onRename } = setup([session("s1", "会话 A", todayIso())])

    openMenu("会话 A")
    fireEvent.click(screen.getByRole("menuitem", { name: /重命名/ }))
    const input = screen.getByRole("textbox", { name: "会话标题" })
    fireEvent.change(input, { target: { value: "不要这个" } })
    fireEvent.keyDown(input, { key: "Escape" })

    expect(onRename).not.toHaveBeenCalled()
    expect(screen.queryByRole("textbox", { name: "会话标题" })).toBeNull()
  })

  it("失败时保留用户输入并给出可重试提示，不静默丢失", async () => {
    const { onRename } = setup([session("s1", "会话 A", todayIso())])
    onRename.mockResolvedValue(false)

    openMenu("会话 A")
    fireEvent.click(screen.getByRole("menuitem", { name: /重命名/ }))
    const input = screen.getByRole("textbox", { name: "会话标题" }) as HTMLInputElement
    fireEvent.change(input, { target: { value: "失败也要留着" } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(screen.getByRole("alert").textContent).toContain("草稿已保留")
    expect(input.value).toBe("失败也要留着")
    expect(onRename).toHaveBeenCalledTimes(1)
  })
})
