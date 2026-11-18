// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render } from "@testing-library/react"

import { ResourcePanel } from "./ResourcePanel"
import type { AgentResources } from "@/lib/agentResources"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const EMPTY: AgentResources = { images: [], documents: [], links: [] }

function panel(resources: AgentResources, props: Partial<Parameters<typeof ResourcePanel>[0]> = {}) {
  return render(
    <ResourcePanel
      open
      resources={resources}
      onClose={() => {}}
      onPreviewImage={() => {}}
      {...props}
    />,
  )
}

describe("ResourcePanel", () => {
  it("空态是诚实的空态：不编造来源，三类各自说明", () => {
    const { container } = panel(EMPTY)
    expect(container.textContent).toContain("这个会话里还没有影像")
    fireEvent.click(container.querySelectorAll('[role="tab"]')[1])
    expect(container.textContent).toContain("只有检索工具真实命中的文档会出现在这里")
    fireEvent.click(container.querySelectorAll('[role="tab"]')[2])
    expect(container.textContent).toContain("还没有出现外部链接")
  })

  it("三类 tab 都有计数，会话级汇总同时可见", () => {
    const { container } = panel({
      images: [
        { id: "image:https://cos.example.com/a.jpg", kind: "image", title: "上传的影像", source: "upload", url: "https://cos.example.com/a.jpg" },
      ],
      documents: [
        { id: "doc:1", kind: "document", title: "干眼共识", source: "knowledge-base", documentId: "1", score: 0.812, snippet: "睑板腺" },
      ],
      links: [
        { id: "link:https://med.org/x", kind: "link", title: "指南", source: "assistant", url: "https://med.org/x", domain: "med.org" },
      ],
    })
    const tabs = container.querySelectorAll('[role="tab"]')
    expect(tabs[0].textContent).toContain("影像 1")
    expect(tabs[1].textContent).toContain("知识来源 1")
    expect(tabs[2].textContent).toContain("链接 1")
    expect(container.textContent).toContain("影像 1 · 来源 1 · 链接 1")
  })

  it("知识来源卡片展示真实相关度与片段，并标注来自检索结果", () => {
    const { container } = panel({
      ...EMPTY,
      documents: [
        {
          id: "doc:1",
          kind: "document",
          title: "干眼共识",
          source: "knowledge-base",
          documentId: "1",
          score: 0.812,
          snippet: "睑板腺功能障碍是干眼的主要原因之一。",
          toolCallId: "call_1",
        },
      ],
    })
    expect(container.querySelector(".agent-panel__score")?.textContent).toContain("0.81")
    expect(container.querySelector(".agent-panel__snippet")?.textContent).toContain("睑板腺")
    expect(container.querySelector(".agent-panel__docid")?.textContent).toContain("#1")
    expect(container.textContent).toContain("不是模型生成的引用")
  })

  it("没有 toolCallId / messageId 时不出现「定位」按钮（不做点不动的装饰）", () => {
    const { container } = panel({
      ...EMPTY,
      documents: [
        { id: "doc:2", kind: "document", title: "无定位", source: "knowledge-base", documentId: "2" },
      ],
    })
    expect(container.querySelector(".agent-panel__locate")).toBeNull()
  })

  it("定位按钮把来源对回执行步骤", () => {
    const onLocate = vi.fn()
    const doc = {
      id: "doc:3",
      kind: "document" as const,
      title: "有定位",
      source: "knowledge-base" as const,
      documentId: "3",
      toolCallId: "call_9",
    }
    const { container } = panel({ ...EMPTY, documents: [doc] }, { onLocate })
    const button = container.querySelector(".agent-panel__locate")
    expect(button?.textContent).toContain("定位执行步骤")
    fireEvent.click(button as Element)
    expect(onLocate).toHaveBeenCalledWith(doc)
  })

  it("上传影像自动加载；第三方图片先要求显式点击，避免把访问行为泄露给外站", () => {
    const { container } = panel({
      images: [
        { id: "image:https://cos.example.com/a.jpg", kind: "image", title: "上传的影像", source: "upload", url: "https://cos.example.com/a.jpg" },
        { id: "image:https://cdn.third.com/b.png", kind: "image", title: "外站图", source: "assistant", url: "https://cdn.third.com/b.png" },
      ],
      documents: [],
      links: [],
    })
    const thumbs = container.querySelectorAll(".agent-panel__img")
    expect(thumbs[0].querySelector("img")).toBeTruthy()
    expect(thumbs[1].querySelector("img")).toBeNull()
    expect(thumbs[1].textContent).toContain("加载外部图片")
    fireEvent.click(thumbs[1])
    expect(container.querySelectorAll(".agent-panel__img")[1].querySelector("img")).toBeTruthy()
  })

  it("图片加载失败时显示失败态，而不是留一个破图", () => {
    const { container } = panel({
      images: [
        { id: "image:https://cos.example.com/gone.jpg", kind: "image", title: "已过期", source: "upload", url: "https://cos.example.com/gone.jpg" },
      ],
      documents: [],
      links: [],
    })
    fireEvent.error(container.querySelector(".agent-panel__img img") as Element)
    expect(container.querySelector(".agent-panel__img.is-failed")?.textContent).toContain(
      "图片无法加载",
    )
  })

  it("链接带出处标签与外链属性；普通外链不标成医学证据", () => {
    const { container } = panel({
      ...EMPTY,
      links: [
        { id: "link:https://med.org/x", kind: "link", title: "指南", source: "assistant", url: "https://med.org/x", domain: "med.org" },
      ],
    })
    fireEvent.click(container.querySelectorAll('[role="tab"]')[2])
    const anchor = container.querySelector(".agent-panel__link a") as HTMLAnchorElement
    expect(anchor.getAttribute("target")).toBe("_blank")
    expect(anchor.getAttribute("rel")).toContain("noreferrer")
    expect(container.textContent).toContain("助手引用")
    expect(container.textContent).toContain("它们不是医学证据")
  })

  it("多回合时可按回合筛选", () => {
    const { container } = panel({
      ...EMPTY,
      documents: [
        { id: "doc:1", kind: "document", title: "第一回合来源", source: "knowledge-base", documentId: "1", round: 1 },
        { id: "doc:2", kind: "document", title: "第二回合来源", source: "knowledge-base", documentId: "2", round: 2 },
      ],
    })
    const select = container.querySelector(".agent-panel__select") as HTMLSelectElement
    expect(select).toBeTruthy()
    fireEvent.change(select, { target: { value: "2" } })
    expect(container.textContent).toContain("第二回合来源")
    expect(container.textContent).not.toContain("第一回合来源")
  })
})
