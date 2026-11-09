import { describe, expect, it } from "vitest"
import {
  MINI_H_MAX,
  MINI_H_MIN,
  RANK_VALUE_CLEARANCE,
  TREND_MIN_LABEL_GAP,
  TREND_PAD,
  TREND_VH_MAX,
  TREND_VH_MIN,
  miniGeometry,
  rankedGeometry,
  trendGeometry,
  trendLabelStep,
} from "./chartGeometry"

/**
 * 图表几何的契约：逻辑宽 = 容器实测宽 ⇒ 缩放比 1 ⇒ 坐标轴文字保持设计字号；
 * 宽屏得到的是更长的绘图区，不是更大的字。这里把这条契约钉死。
 */

describe("trendGeometry", () => {
  it("窄容器：逻辑高压到下限 240，绘图区随宽度缩", () => {
    const g = trendGeometry(320)
    expect(g.vh).toBe(TREND_VH_MIN)
    expect(g.plotX0).toBe(TREND_PAD.left)
    expect(g.plotX1).toBe(320 - TREND_PAD.right)
    expect(g.plotW).toBe(320 - TREND_PAD.left - TREND_PAD.right)
  })

  it("常规宽度（640）：逻辑高仍是 240——与移植前的固定 viewBox 同形", () => {
    const g = trendGeometry(640)
    expect(g.vh).toBe(240)
    expect(g.plotY1).toBe(240 - TREND_PAD.bottom)
  })

  it("宽屏（1100）：逻辑高封顶 360，不再被拉成扁带", () => {
    const g = trendGeometry(1100)
    expect(g.vh).toBe(TREND_VH_MAX)
    expect(g.plotW).toBe(1100 - TREND_PAD.left - TREND_PAD.right)
  })

  it("绘图区宽度随逻辑宽单调变长（宽屏 = 更长的横轴）", () => {
    expect(trendGeometry(1100).plotW).toBeGreaterThan(trendGeometry(640).plotW)
  })
})

describe("rankedGeometry", () => {
  it("轨道末与数值列留够净距：最长那条条不撞数字", () => {
    const g = rankedGeometry(640, 10)
    expect(g.valueX - g.trackX1).toBe(RANK_VALUE_CLEARANCE)
    expect(RANK_VALUE_CLEARANCE).toBeGreaterThanOrEqual(32)
  })

  it("占比列右缘贴右留白，数值列在其左侧", () => {
    const g = rankedGeometry(640, 10)
    expect(g.shareX).toBe(640 - 16)
    expect(g.valueX).toBeLessThan(g.shareX)
  })

  it("行块高度 = 上下留白 + 每行 40px", () => {
    expect(rankedGeometry(640, 10).height).toBe(24 + 10 * 40)
    expect(rankedGeometry(640, 0).height).toBe(24 + 40)
  })

  it("容器变宽时轨道吃掉余量（名称带与数值带不跟着长）", () => {
    const narrow = rankedGeometry(640, 10)
    const wide = rankedGeometry(1200, 10)
    expect(wide.trackW).toBeGreaterThan(narrow.trackW)
    expect(wide.trackX0).toBe(narrow.trackX0)
  })
})

describe("trendLabelStep", () => {
  it("宽绘图区：每个点都画标签（步长 1）", () => {
    expect(trendLabelStep(516, 7)).toBe(1)
  })

  it("窄绘图区：按最小净距抽稀，隔一个画一个", () => {
    const step = trendLabelStep(196, 7)
    expect(step).toBe(2)
    expect(196 / 6).toBeLessThan(TREND_MIN_LABEL_GAP)
  })

  it("单个点不抽稀", () => {
    expect(trendLabelStep(196, 1)).toBe(1)
  })
})

describe("miniGeometry", () => {  it("小格：逻辑高落到下限 64", () => {
    expect(miniGeometry(200).h).toBe(MINI_H_MIN)
  })

  it("宽格：逻辑高封顶 120（不会被拉成扁带）", () => {
    expect(miniGeometry(600).h).toBe(MINI_H_MAX)
  })
})
