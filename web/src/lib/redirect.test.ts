import { describe, expect, it } from "vitest"
import { safeRedirect } from "./redirect"

describe("safeRedirect", () => {
  it("放行站内相对路径", () => {
    expect(safeRedirect("/diagnosis")).toBe("/diagnosis")
    expect(safeRedirect("/records/123?tab=all#top")).toBe("/records/123?tab=all#top")
    expect(safeRedirect(null)).toBe("/diagnosis")
    expect(safeRedirect(undefined, "/login")).toBe("/login")
  })

  it("拒绝协议相对与反斜杠外站", () => {
    expect(safeRedirect("//evil.com")).toBe("/diagnosis")
    expect(safeRedirect("/\\evil.com")).toBe("/diagnosis")
    expect(safeRedirect("https://evil.com")).toBe("/diagnosis")
    expect(safeRedirect("evil.com")).toBe("/diagnosis")
    expect(safeRedirect("/\\")).toBe("/diagnosis")
  })

  it("拒绝控制字符与空白嵌套，避免 URL 解析后越界", () => {
    expect(safeRedirect("/\t/evil.com")).toBe("/diagnosis")
    expect(safeRedirect("/\n/evil.com")).toBe("/diagnosis")
    expect(safeRedirect("/%09/evil.com")).toBe("/%09/evil.com")
    expect(safeRedirect(" /records")).toBe("/diagnosis")
    expect(safeRedirect("/records ")).toBe("/records ")
  })
})
