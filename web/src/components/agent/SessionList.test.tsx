// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
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
  const onTogglePin = vi.fn()
  render(
    <SessionList
      sessions={sessions}
      activeId=""
      busy={false}
      onNewChat={vi.fn()}
      onSelect={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      onBatchDelete={vi.fn()}
      onTogglePin={onTogglePin}
      onExport={vi.fn()}
      onCollapse={vi.fn()}
    />,
  )
  return { onTogglePin }
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
