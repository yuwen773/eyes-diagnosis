import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * vendored 第三方代码的「可追溯性」不能只靠人记得。
 * 固定上游 commit 与许可声明一旦被删掉，下次换 SHA 就没人知道该拿什么来比对。
 *
 * 这里只守两件最容易丢的事：固定 commit SHA 与许可名称仍然在位。
 * 着色器哈希的逐字比对仍是人工步骤（见 THIRD-PARTY-NOTICES.md「校验」一节）。
 */
const dir = fileURLToPath(new URL(".", import.meta.url))
const notices = readFileSync(`${dir}THIRD-PARTY-NOTICES.md`, "utf8")
const engine = readFileSync(`${dir}beamsEngine.ts`, "utf8")

const UPSTREAM_SHA = "ed33ebe4acfe29e60fb759bcccc70a138ce2dcef"

describe("vendored Beams 的来源与许可", () => {
  it("固定上游 commit SHA 记录在声明文件与源文件头两处", () => {
    expect(notices).toContain(UPSTREAM_SHA)
    expect(engine).toContain(UPSTREAM_SHA)
  })

  it("许可名称与著作人保留", () => {
    expect(notices).toContain("MIT")
    expect(notices).toContain("Commons Clause")
    expect(notices).toContain("David Haz")
    expect(engine).toContain("Commons Clause")
  })

  it("上游地址与源文件路径可追溯", () => {
    expect(notices).toContain("github.com/DavidHDev/react-bits")
    expect(notices).toContain("Beams.jsx")
  })
})
