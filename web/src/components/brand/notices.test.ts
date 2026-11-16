import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * vendored 第三方代码的「可追溯性」不能只靠人记得。
 * 来源、取用时间与许可声明一旦被删掉，下次换版本就没人知道该拿什么来比对。
 *
 * 这里只守两件最容易丢的事：来源/取用记录仍然在位，许可名称仍然在位。
 * 着色器逐字比对仍是人工步骤（见 THIRD-PARTY-NOTICES.md）。
 */
const dir = fileURLToPath(new URL(".", import.meta.url))
const notices = readFileSync(`${dir}THIRD-PARTY-NOTICES.md`, "utf8")
const prism = readFileSync(`${dir}Prism.tsx`, "utf8")

describe("vendored Prism 的来源与许可", () => {
  it("来源与取用时间记录在声明文件里", () => {
    expect(notices).toContain("github.com/DavidHDev/react-bits")
    expect(notices).toContain("Prism.jsx")
    expect(notices).toContain("2026-11-16")
  })

  it("许可名称与著作人保留", () => {
    expect(notices).toContain("MIT")
    expect(notices).toContain("Commons Clause")
    expect(notices).toContain("David Haz")
  })

  it("源文件头保留来源与许可", () => {
    expect(prism).toContain("React Bits")
    expect(prism).toContain("Commons Clause")
    expect(prism).toContain("David Haz")
  })
})
