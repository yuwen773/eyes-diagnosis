/// <reference types="node" />
// 系统状态的对比度门禁：严重度标签是 11px/600 小字，必须满足 WCAG AA 4.5:1。
// 早期版本把标签文字染成 --risk-* 并垫 12% 同色淡底，实测 3.69–4.16:1；
// 现在文字走 --fg、底色走 --surface-2，这里把这两条锁住。
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function lin(c: number) {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8")
const dark = tokens.slice(tokens.indexOf("html.dark {"))
const value = (source: string, name: string) =>
  new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(source)![1]

const css = readFileSync(new URL("./system-states.css", import.meta.url), "utf8")
function chipBlock() {
  const start = css.indexOf(".iris-error__severity {")
  expect(start).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf("}", start))
}

describe("系统状态 · 严重度标签对比度", () => {
  it("标签文字与衬底都不依赖 --risk-* 染色", () => {
    const chip = chipBlock()
    expect(chip).not.toMatch(/color:\s*var\(--iris-severity\)/)
    expect(chip).not.toMatch(/background:\s*color-mix/)
    expect(chip).toContain("color: var(--fg)")
    expect(chip).toContain("background: var(--surface-2)")
  })

  it("浅色与暗色下 --fg 压在 --surface-2 上都 ≥ 4.5:1", () => {
    // 浅色：--fg = --ink = --paper-ink。
    expect(contrast(value(tokens, "--paper-ink"), value(tokens, "--surface-2"))).toBeGreaterThanOrEqual(4.5)
    // 暗色：html.dark 把 --ink 翻成 --on-dark（tokens.css:623），--fg 跟随它。
    expect(contrast(value(tokens, "--on-dark"), value(dark, "--surface-2"))).toBeGreaterThanOrEqual(4.5)
  })
})

/**
 * 语义色只做第二通道：严重度文字一律使用 --fg / --surface-2，
 * 不直接染成 --risk-*（早期实测在浅色衬底只有 3.69–4.16:1）。
 */
describe("R2 分层状态对比度约束", () => {
  it("表单与内容区严重度文字用前景色，不用风险色直接做文字", () => {
    for (const selector of [".iris-form-alert__title", ".iris-form-alert__severity", ".iris-section-state__severity", ".iris-refresh-notice__text"]) {
      const block = css.split(selector)[1]?.split("}")[0] ?? ""
      expect(block).toMatch(/color:\s*var\(--fg\)/)
      expect(block).not.toMatch(/color:\s*var\(--risk-/)
    }
  })

  it("所有恢复动作保持 44px 触控目标", () => {
    const block = css.split(".iris-form-alert__retry,")[1]?.split("}")[0] ?? ""
    expect(block).toContain("min-height: 44px")
  })

  it("reduced-motion 下恢复动作不transition", () => {
    const reduced = css.split("prefers-reduced-motion: reduce")[1] ?? ""
    expect(reduced).toContain(".iris-form-alert__retry")
    expect(reduced).toContain("transition: none")
  })
})
