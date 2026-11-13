// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  downloadText,
  exportDescriptor,
  safeFileName,
} from "./sessionExport"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("safeFileName", () => {
  it("removes path separators, reserved punctuation and control characters", () => {
    expect(safeFileName(" ..\\/:*?\"<>|症状\u0000记录. ")).toBe("症状记录")
    expect(safeFileName("CON")).toBe("会话")
    expect(safeFileName("NUL.txt")).toBe("会话")
    expect(safeFileName("...")).toBe("会话")
  })

  it("caps the base length and labels markdown headers as plain files", () => {
    expect(safeFileName("x".repeat(200))).toHaveLength(48)
    expect(safeFileName("## 标题")).toBe("## 标题")
  })
})

describe("exportDescriptor", () => {
  it("never puts the session title or message content into the filename", () => {
    const descriptor = exportDescriptor("thread-a1", "json")
    expect(descriptor.filename).toBe("会话导出-thread-a1.json")
    expect(descriptor.filename).not.toMatch(/症状|患者|张/)
    expect(descriptor.mime).toBe("application/json;charset=utf-8")
    expect(exportDescriptor("thread-a1", "markdown")).toEqual({
      filename: "会话导出-thread-a1.md",
      mime: "text/markdown;charset=utf-8",
      extension: "md",
    })
  })

  it("falls back to a neutral name for hostile session ids", () => {
    expect(exportDescriptor("../../private\u0000", "json").filename)
      .toBe("会话导出-private.json")
    expect(exportDescriptor(":::???", "markdown").filename).toBe("会话导出.md")
  })
})

describe("downloadText", () => {
  it("starts a Blob download with the declared name and MIME", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:fake")
    const revokeObjectURL = vi.fn()
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})

    const failure = downloadText("# synthetic", exportDescriptor("thread-a1", "markdown"))

    expect(failure).toBeUndefined()
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(document.querySelector("a[download]")).toBeNull()
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe("text/markdown;charset=utf-8")
  })

  it("reports a download error instead of throwing from the click handler", () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockImplementation(() => { throw new Error("quota") }),
      revokeObjectURL: vi.fn(),
    })
    const failure = downloadText("{}", exportDescriptor("thread-a1", "json"))
    expect(failure).toBe("下载失败，请重试")
  })

  it("rejects non-string payloads from a malformed envelope", () => {
    const failure = downloadText(null as unknown as string,
      exportDescriptor("thread-a1", "json"))
    expect(failure).toBe("导出内容无效")
  })
})
