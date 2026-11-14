// @vitest-environment jsdom
import { describe, expect, it } from "vitest"

import {
  PREVIEW_DEVICE_HEIGHT,
  PREVIEW_DEVICE_WIDTH,
  previewScale,
} from "./newsPreview"

describe("previewScale", () => {
  it("画布装得下逻辑宽度时按 1:1 呈现，不放大", () => {
    expect(previewScale(1240, 1240)).toBe(1)
    expect(previewScale(1600, 1240)).toBe(1)
    expect(previewScale(390, 390)).toBe(1)
  })

  it("画布装不下时按比例缩小，且不超过 1", () => {
    expect(previewScale(620, 1240)).toBeCloseTo(0.5, 10)
    expect(previewScale(250, 390)).toBeCloseTo(0.641, 3)
    // 装不下也只缩不放：放大会让「模拟视口 1240」这句读数变成假话。
    expect(previewScale(2000, 1240)).toBe(1)
  })

  it("量不出来的时候按 1 处理，不把预览缩成一条", () => {
    expect(previewScale(0, 1240)).toBe(1)
    expect(previewScale(Number.NaN, 1240)).toBe(1)
    expect(previewScale(1240, 0)).toBe(1)
    expect(previewScale(-100, 1240)).toBe(1)
  })
})

describe("设备框的逻辑尺寸", () => {
  it("桌面 1240 / 手机 390，与公开页版心和手机视口一致", () => {
    expect(PREVIEW_DEVICE_WIDTH.desktop).toBe(1240)
    expect(PREVIEW_DEVICE_WIDTH.mobile).toBe(390)
  })

  it("纵向模拟高度也写死，不跟着管理员窗口变", () => {
    expect(PREVIEW_DEVICE_HEIGHT.desktop).toBe(900)
    expect(PREVIEW_DEVICE_HEIGHT.mobile).toBe(844)
  })
})
