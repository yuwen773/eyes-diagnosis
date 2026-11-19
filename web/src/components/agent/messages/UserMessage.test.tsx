// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"

import { UserMessage } from "./UserMessage"
import type { StreamMessage } from "@/lib/agentStream"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function user(over: Partial<StreamMessage> = {}): StreamMessage {
  return {
    id: "u1",
    type: "user",
    content: "帮我看看这张图",
    ...over,
  } as StreamMessage
}

/**
 * P1-03 第二道闸：真相别处已经决定了（信封标记），这里保证即便消息体
 * 带着不该有的地址，也不会真的被渲染成图片去拉取。
 */
describe("UserMessage 附件闸", () => {
  it("上传命名空间里的地址正常渲染", () => {
    const { container } = render(
      <UserMessage msg={user({ images: ["/api/agent/image/view/a.png"] })} />,
    )
    const imgs = container.querySelectorAll("img")
    expect(imgs).toHaveLength(1)
    expect(imgs[0].getAttribute("src")).toBe("/api/agent/image/view/a.png")
  })

  it("第三方地址不渲染，也不留下空缩略图", () => {
    const { container } = render(
      <UserMessage msg={user({ images: ["https://tracker.example.net/pixel.png"] })} />,
    )
    expect(container.querySelectorAll("img")).toHaveLength(0)
    expect(container.querySelector(".agent-msg__imggrid")).toBeNull()
    // 正文照常显示——被丢掉的只是附件身份，不是用户说的话
    expect(container.querySelector(".agent-msg__text")?.textContent).toBe("帮我看看这张图")
  })

  it("混合地址里只渲染可信的那张", () => {
    const { container } = render(
      <UserMessage
        msg={user({
          images: ["https://tracker.example.net/pixel.png", "/api/agent/image/view/ok.png"],
        })}
      />,
    )
    const imgs = container.querySelectorAll("img")
    expect(imgs).toHaveLength(1)
    expect(imgs[0].getAttribute("src")).toBe("/api/agent/image/view/ok.png")
  })
})
