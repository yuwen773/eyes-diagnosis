import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./api", () => ({
  uploadAgentImage: vi.fn(),
}))

vi.mock("./agentImageOwnership", () => ({
  acquireAgentImage: vi.fn(),
  releaseAgentImage: vi.fn(),
  retainAgentImage: vi.fn(),
}))

const importUpload = async () =>
  (await import("./agentUpload")) as typeof import("./agentUpload")
const api = () => import("./api")
const ownership = () => import("./agentImageOwnership")

// File 指纹 = name:size:lastModified；同指纹 = 同一个 File 引用（或手工构造同值）
const makeFile = (name: string, size: number) => new File(["x".repeat(size)], name, { lastModified: 1 })

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe("useAgentUpload", () => {
  it("正常上传返回 urls 且逐个 acquire", async () => {
    const { useAgentUpload } = await importUpload()
    const { uploadAgentImage } = await api()
    const { acquireAgentImage } = await ownership()

    vi.mocked(uploadAgentImage).mockResolvedValue("https://cos/1.jpg")
    const file = makeFile("a.png", 10)

    const { urls } = await useAgentUpload().uploadFiles([file])

    expect(urls).toEqual(["https://cos/1.jpg"])
    expect(uploadAgentImage).toHaveBeenCalledTimes(1)
    expect(vi.mocked(acquireAgentImage)).toHaveBeenCalledWith("https://cos/1.jpg")
  })

  it("同指纹并发合并请求（两次 uploadFiles 同一个 File 引用，mock 只调一次）", async () => {
    const { useAgentUpload } = await importUpload()
    const { uploadAgentImage } = await api()
    const { acquireAgentImage } = await ownership()

    // 挂起一次 promise：两个批次共用同一上传
    let resolve!: (url: string) => void
    vi.mocked(uploadAgentImage).mockImplementation(
      () => new Promise<string>((r) => (resolve = r)),
    )
    const file = makeFile("b.png", 20)
    const upload = useAgentUpload()

    const p1 = upload.uploadFiles([file])
    const p2 = upload.uploadFiles([file])
    resolve("https://cos/2.jpg")

    const [r1, r2] = await Promise.all([p1, p2])
    expect(uploadAgentImage).toHaveBeenCalledTimes(1)
    expect(r1.urls).toEqual(["https://cos/2.jpg"])
    expect(r2.urls).toEqual(["https://cos/2.jpg"])
    // 去重只合并网络请求，不合并所有权：两个批次各登记一份
    expect(vi.mocked(acquireAgentImage)).toHaveBeenCalledTimes(2)
  })

  it("失败回滚本批次：第一个成功第二个失败 → 对第一个 release", async () => {
    const { useAgentUpload } = await importUpload()
    const { uploadAgentImage } = await api()
    const { releaseAgentImage } = await ownership()

    vi.mocked(uploadAgentImage)
      .mockResolvedValueOnce("https://cos/ok.jpg")
      .mockRejectedValueOnce(new Error("upload failed"))
    const upload = useAgentUpload()

    await expect(
      upload.uploadFiles([makeFile("c.png", 5), makeFile("d.png", 5)]),
    ).rejects.toThrow("upload failed")

    expect(vi.mocked(releaseAgentImage)).toHaveBeenCalledWith("https://cos/ok.jpg")
  })

  it("commitSuccess → retain；commitFailure → release", async () => {
    const { useAgentUpload } = await importUpload()
    const { retainAgentImage, releaseAgentImage } = await ownership()

    const upload = useAgentUpload()
    upload.commitSuccess(["https://cos/s.jpg"])
    upload.commitFailure(["https://cos/f.jpg"])

    expect(vi.mocked(retainAgentImage)).toHaveBeenCalledWith("https://cos/s.jpg")
    expect(vi.mocked(releaseAgentImage)).toHaveBeenCalledWith("https://cos/f.jpg")
  })
})
