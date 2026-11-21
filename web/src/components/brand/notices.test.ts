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
const beams = readFileSync(`${dir}beamsEngine.ts`, "utf8")
const pkg = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }

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

/**
 * Beams 与 Prism 出自同一上游、同一份许可。E-09 把 Beams 的 vendor 副本带进
 * 这个目录，为的是让「方案 A」对照跑真实组件；来源与固定 commit 同样不能丢。
 */
describe("vendored Beams 的来源与许可", () => {
  it("来源、固定 commit 与取用时间记录在声明文件里", () => {
    expect(notices).toContain("Beams.jsx")
    expect(notices).toContain("ed33ebe4acfe29e60fb759bcccc70a138ce2dcef")
    expect(notices).toContain("2026-11-12")
  })

  it("源文件头保留来源与许可", () => {
    expect(beams).toContain("React Bits")
    expect(beams).toContain("Commons Clause")
    expect(beams).toContain("David Haz")
  })
})

/**
 * R3 的五种交互（Prompt Bar / Thought Line / Lattice Loader / Animated
 * Content / Glare Hover）是**自研实现**，不是 React Bits 源码。
 *
 * <p>这条断言守的是许可边界：Commons Clause 禁止再分发组件本身（含移植版），
 * 而本仓库是公开仓库。哪天上游的组件源码被整段搬进来，这条测试就该红。
 */
describe("R3 的 React Bits 交互实现是自研的", () => {
  it("声明文件逐条写明五种交互各自的独立实现", () => {
    expect(notices).toContain("独立实现")
    for (const name of [
      "Prompt Bar",
      "Thought Line",
      "Lattice Loader",
      "Animated Content",
      "Glare Hover",
    ]) {
      expect(notices).toContain(name)
    }
  })

  it("声明文件钉住了上游的 commit 锚点（上游无 tag）", () => {
    expect(notices).toContain("d01aa914dcbe76da8b2923ebf871b5c8b1066e4c")
  })

  it("没有因为这些交互引入新的第三方依赖", () => {
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    for (const forbidden of ["motion", "gsap", "three", "@react-three/fiber", "@hugeicons"]) {
      expect(deps).not.toContain(forbidden)
    }
  })
})
