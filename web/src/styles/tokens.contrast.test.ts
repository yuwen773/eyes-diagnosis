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

/** 玻璃材质是 rgba：对比度必须按「压在画布上合成之后的实际颜色」算，不能只看字面 alpha。 */
type Rgba = { r: number; g: number; b: number; a: number }

function parseColor(raw: string): Rgba {
  const rgba = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(raw)
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] === undefined ? 1 : Number(rgba[4]),
    }
  }
  const hex = /^#([0-9a-fA-F]{6})$/.exec(raw)
  if (!hex) throw new Error(`不认识的色值：${raw}`)
  const n = parseInt(hex[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
}

/** 把半透明前景合成到不透明背景上，返回不透明十六进制。 */
function over(foreground: string, background: string): string {
  const fg = parseColor(foreground)
  const bg = parseColor(background)
  const mix = (f: number, b: number) => Math.round(f * fg.a + b * (1 - fg.a))
  return `#${[mix(fg.r, bg.r), mix(fg.g, bg.g), mix(fg.b, bg.b)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`
}

/** 取令牌的原始字面值（可能是 #hex，也可能是 rgba）。 */
const rawValue = (name: string) =>
  new RegExp(`${name}:\\s*([^;]+);`).exec(css)![1].trim()
const rawDarkValue = (name: string) =>
  new RegExp(`${name}:\\s*([^;]+);`).exec(darkCss)![1].trim()

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

describe("品牌材质 · 文字压在半透明玻璃上", () => {
  const GLASS = [
    "--brand-glass-frosted",
    "--brand-glass-layered",
    "--brand-glass-soft",
  ]

  it("浅色：正文与次要文字合成到画布后仍 ≥ 4.5", () => {
    for (const glass of GLASS) {
      const surface = over(rawValue(glass), value("--brand-canvas"))
      for (const fg of ["--brand-text", "--brand-muted"]) {
        expect(contrast(value(fg), surface)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it("浅色：玻璃的静态替代面也 ≥ 4.5", () => {
    const surface = over(rawValue("--brand-glass-fallback"), value("--brand-canvas"))
    for (const fg of ["--brand-text", "--brand-muted"]) {
      expect(contrast(value(fg), surface)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("暗色：合成到午夜蓝画布后仍 ≥ 4.5", () => {
    for (const glass of GLASS) {
      const surface = over(rawDarkValue(glass), darkValue("--brand-canvas"))
      for (const fg of ["--brand-text", "--brand-muted"]) {
        expect(contrast(darkValue(fg), surface)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it("暗色最坏情况：玻璃背后是光学带最亮处，文字仍要 ≥ 4.5", () => {
    // 首屏信息卡压在光带上，而不是纯画布上。用光带的亮色当背衬取最坏值：
    // 玻璃若不够实，次要文字会在光带经过时被吃掉。
    const brightBacking = over(darkValue("--brand-cyan"), darkValue("--brand-canvas"))
    for (const glass of ["--brand-glass-layered", "--brand-glass-frosted"]) {
      const surface = over(rawDarkValue(glass), brightBacking)
      for (const fg of ["--brand-text", "--brand-muted"]) {
        expect(contrast(darkValue(fg), surface)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

describe("品牌材质 · 样式硬约束（静态检查 brand.css）", () => {
  const brandCss = readFileSync(new URL("./brand.css", import.meta.url), "utf8")

  it("五种材质各有独立的模糊强度，不是一个值套到底", () => {
    for (const token of [
      "--brand-glass-frosted-blur",
      "--brand-glass-layered-blur",
      "--brand-glass-soft-blur",
    ]) {
      expect(brandCss).toContain(token)
    }
  })

  it("不支持 backdrop-filter 时有静态替代，不能塌成一块灰", () => {
    expect(brandCss).toContain("@supports not")
    expect(brandCss).toContain("--brand-glass-fallback")
  })

  it("内侧高光单独一层，玻璃厚度不靠加厚阴影", () => {
    expect(brandCss).toContain(".brand-panel::before")
    expect(brandCss).toContain("var(--glass-inner)")
  })

  it("不使用 backdrop-filter 的实体面明确关掉模糊", () => {
    expect(brandCss).toMatch(/\.brand-panel--solid[\s\S]*?backdrop-filter:\s*none/)
  })
})

describe("品牌页脚 · 深海蓝实体面", () => {
  const FOOTER = ["--brand-surface-deep"]
  const DARK_FOOTER = ["--brand-surface-deep"]

  it("浅色页面上的页脚：正文与次要文字 ≥ 4.5", () => {
    for (const surface of FOOTER.map(value)) {
      expect(contrast(value("--brand-deep-text"), surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(value("--brand-deep-muted"), surface)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("暗色页面上的页脚仍有独立明度层级：与页面底色不同", () => {
    for (const surface of DARK_FOOTER.map(darkValue)) {
      expect(contrast(darkValue("--brand-deep-text"), surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(darkValue("--brand-deep-muted"), surface)).toBeGreaterThanOrEqual(4.5)
      // 不能与画布同色——那样页脚会融进主体消失。
      expect(surface.toLowerCase()).not.toBe(darkValue("--brand-canvas").toLowerCase())
      expect(contrast(surface, darkValue("--brand-canvas"))).toBeGreaterThan(1)
    }
  })
})
