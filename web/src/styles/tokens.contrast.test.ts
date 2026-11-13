/// <reference types="node" />
// app 的 tsconfig 只带 vite/client；这个测试跑 node 环境，单独把 node 类型引进来。
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

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8")
const value = (name: string) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)![1]
// 暗主题覆盖写在 html.dark 块里，同名令牌取第一段 html.dark 之后的值。
const darkCss = css.slice(css.indexOf("html.dark {"))
const darkValue = (name: string) =>
  new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(darkCss)![1]

describe("正文三级色对比度", () => {
  it("浅底 paper-ink-3 ≥ 4.5", () => {
    expect(contrast(value("--paper-ink-3"), value("--field"))).toBeGreaterThanOrEqual(4.5)
  })
  it("暗底 on-dark-3 ≥ 4.5（含二级抬升面）", () => {
    expect(contrast(value("--on-dark-3"), value("--dark"))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(value("--on-dark-3"), "#242a27")).toBeGreaterThanOrEqual(4.5)
  })
  it("橙色文字 ≥ 4.5", () => {
    expect(contrast(value("--paper-signal-text"), value("--field"))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(value("--paper-signal-text"), value("--surface"))).toBeGreaterThanOrEqual(4.5)
  })
})

describe("图表分类色板", () => {
  const LIGHT = [1, 2, 3, 4, 5, 6].map((n) => value(`--viz-series-${n}`))
  const DARK = [1, 2, 3, 4, 5, 6].map((n) => darkValue(`--viz-series-${n}`))

  it("浅色底上每色 ≥ 3:1（图形元素可辨识下限）", () => {
    for (const color of LIGHT) {
      expect(contrast(color, value("--surface"))).toBeGreaterThanOrEqual(3)
      expect(contrast(color, value("--field"))).toBeGreaterThanOrEqual(3)
    }
  })

  it("暗色底上每色 ≥ 3:1", () => {
    for (const color of DARK) {
      expect(contrast(color, "#1d2220")).toBeGreaterThanOrEqual(3)
    }
  })

  it("六色互不重复：颜色虽非唯一载体，但重复会直接抹掉系列区分", () => {
    expect(new Set(LIGHT).size).toBe(LIGHT.length)
    expect(new Set(DARK).size).toBe(DARK.length)
  })
})

describe("Iris 2.0 品牌层", () => {
  it("浅色：正文与次要文字在画布与卡片上都 ≥ 4.5", () => {
    for (const fg of ["--brand-text", "--brand-muted"]) {
      expect(contrast(value(fg), value("--brand-canvas"))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(value(fg), value("--brand-surface"))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("暗色：正文与次要文字在画布与卡片上都 ≥ 4.5", () => {
    for (const fg of ["--brand-text", "--brand-muted"]) {
      expect(contrast(darkValue(fg), darkValue("--brand-canvas"))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(darkValue(fg), darkValue("--brand-surface"))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("主色当按钮底时，压在上面的文字 ≥ 4.5", () => {
    expect(contrast(value("--brand-primary-fg"), value("--brand-primary"))).toBeGreaterThanOrEqual(4.5)
    expect(
      contrast(darkValue("--brand-primary-fg"), darkValue("--brand-primary")),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it("青与极光紫当文字色时也 ≥ 4.5——点缀色不豁免可读性", () => {
    for (const fg of ["--brand-cyan", "--brand-aurora"]) {
      expect(contrast(value(fg), value("--brand-surface"))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(darkValue(fg), darkValue("--brand-surface"))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("品牌色不得与医学风险色同值：两种语义不能共用一枚颜色", () => {
    const risks = [
      "--paper-risk-normal",
      "--paper-risk-attention",
      "--paper-risk-critical",
      "--risk-normal-lit",
      "--risk-attention-lit",
      "--risk-critical-lit",
    ].map((name) => value(name))
    for (const brand of ["--brand-primary", "--brand-cyan", "--brand-aurora"]) {
      for (const risk of risks) {
        expect(value(brand)).not.toBe(risk)
        expect(darkValue(brand)).not.toBe(risk)
      }
    }
  })
})
