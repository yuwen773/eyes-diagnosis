// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest"
import { AUTH_EXPIRED_EVENT } from "./http"
import { diagnosisTaskApi } from "./diagnosisTaskApi"

afterEach(() => vi.unstubAllGlobals())
it("沿用文件和受理键提交影像，使用cookie和取消信号", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      Response.json({
        code: 0,
        data: { taskId: "task-a", status: "PROCESSING" },
      })
    )
  vi.stubGlobal("fetch", fetch)
  const file = new File(["synthetic"], "synthetic.png", { type: "image/png" })
  const signal = new AbortController().signal
  await diagnosisTaskApi.create(file, "same-admission-key", signal)
  const init = fetch.mock.calls[0][1]
  expect(init).toMatchObject({
    method: "POST",
    credentials: "include",
    cache: "no-store",
    signal,
  })
  expect(init.body.get("file")).toBe(file)
  expect(init.body.get("idempotencyKey")).toBe("same-admission-key")
})
it("HTTP200身份失效信封仍触发清理广播并拒绝读取", async () => {
  const expired = vi.fn()
  window.addEventListener(AUTH_EXPIRED_EVENT, expired)
  try {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ code: 40100, msg: "NOT_LOGIN" }))
    )
    await expect(
      diagnosisTaskApi.list(new AbortController().signal)
    ).rejects.toMatchObject({ status: 401 })
    expect(expired).toHaveBeenCalledOnce()
  } finally {
    window.removeEventListener(AUTH_EXPIRED_EVENT, expired)
  }
})
it("未知影像任务状态降级为 UNKNOWN——既不当成推理中，也不当成已就绪", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      Response.json({
        code: 0,
        data: { taskId: "task-b", status: "DRAFTING_V2" },
      })
    )
  vi.stubGlobal("fetch", fetch)
  await expect(
    diagnosisTaskApi.get("task-b", new AbortController().signal)
  ).resolves.toEqual({ taskId: "task-b", status: "UNKNOWN" })
})
it("错误响应体不是 JSON 时按 HTTP 状态失败，不冒充成功也不当作解析异常", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response("<html>502</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      })
    )
  vi.stubGlobal("fetch", fetch)
  await expect(
    diagnosisTaskApi.list(new AbortController().signal)
  ).rejects.toMatchObject({ status: 502 })
})
