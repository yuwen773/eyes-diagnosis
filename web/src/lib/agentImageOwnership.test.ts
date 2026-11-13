import { beforeEach, describe, expect, it, vi } from "vitest"

// 账本是模块级 Map：每个用例重置模块后动态 import，保证状态隔离。
vi.mock("./api", () => ({
  // 返回 Promise：实现里会 .catch() 它
  deleteAgentImage: vi.fn().mockResolvedValue(true),
}))

const importLedger = async () => {
  const mod = await import("./agentImageOwnership")
  return mod as typeof import("./agentImageOwnership")
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe("agentImageOwnership", () => {
  it("acquire 两次 release 一次不删", async () => {
    const { acquireAgentImage, releaseAgentImage } = await importLedger()
    const { deleteAgentImage } = await import("./api")

    acquireAgentImage("https://cos/a.jpg")
    acquireAgentImage("https://cos/a.jpg")
    releaseAgentImage("https://cos/a.jpg")

    expect(deleteAgentImage).not.toHaveBeenCalled()
  })

  it("最后持有者 release 才删", async () => {
    const { acquireAgentImage, releaseAgentImage } = await importLedger()
    const { deleteAgentImage } = await import("./api")

    acquireAgentImage("https://cos/b.jpg")
    acquireAgentImage("https://cos/b.jpg")
    releaseAgentImage("https://cos/b.jpg")
    releaseAgentImage("https://cos/b.jpg")

    expect(deleteAgentImage).toHaveBeenCalledTimes(1)
    expect(vi.mocked(deleteAgentImage)).toHaveBeenCalledWith("https://cos/b.jpg")
  })

  it("retain 后永不删（消息已送达，对象归消息所有）", async () => {
    const { acquireAgentImage, retainAgentImage, releaseAgentImage } = await importLedger()
    const { deleteAgentImage } = await import("./api")

    acquireAgentImage("https://cos/c.jpg")
    retainAgentImage("https://cos/c.jpg")
    releaseAgentImage("https://cos/c.jpg")

    expect(deleteAgentImage).not.toHaveBeenCalled()
  })

  it("同一 URL 重复删除只发一次请求", async () => {
    const { acquireAgentImage, releaseAgentImage } = await importLedger()
    const { deleteAgentImage } = await import("./api")

    acquireAgentImage("https://cos/d.jpg")
    releaseAgentImage("https://cos/d.jpg")
    releaseAgentImage("https://cos/d.jpg")

    expect(deleteAgentImage).toHaveBeenCalledTimes(1)
  })

  it("空串 no-op；未登记的 URL 按 0 持有者释放=删除（与 Vue 版语义一致）", async () => {
    const { releaseAgentImage } = await importLedger()
    const { deleteAgentImage } = await import("./api")

    releaseAgentImage("")
    expect(deleteAgentImage).not.toHaveBeenCalled()

    // 未登记 URL：holders 无记录 → count 0 → 走删除（与 Vue 版逐行移植语义一致）
    releaseAgentImage("https://cos/never-acquired.jpg")
    expect(deleteAgentImage).toHaveBeenCalledTimes(1)
  })
})
