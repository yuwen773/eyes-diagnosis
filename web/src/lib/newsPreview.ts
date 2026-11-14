/**
 * 资讯预览的设备框几何。
 *
 * <p>设备框有两个宽度：**逻辑宽度**（排版用）与**呈现宽度**（屏幕上看到的）。
 *
 * <p>逻辑宽度是固定的：桌面 1240（公开页版心）、手机 390（公开页手机视口）。
 * 断点、字号、留白都按逻辑宽度算——与公开页「同宽即同版式」是同一条口径。
 *
 * <p>画布装不下逻辑宽度时（管理员窗口窄、或者在手机上开预览），设备框
 * **整体等比例缩小**，而不是按画布宽度重新排版：缩到 60% 的桌面预览仍然是
 * 1240 的版式，只是小了一圈。重新排版等于给管理员看另一篇文章，
 * 「预览与公开页同版式」这条承诺就没了。
 */

/** 设备框的逻辑宽度（px）。 */
export const PREVIEW_DEVICE_WIDTH = {
  desktop: 1240,
  mobile: 390,
} as const

export type PreviewDevice = keyof typeof PREVIEW_DEVICE_WIDTH

/**
 * 纵向模拟视口高度（px）。
 *
 * <p>文章眉线与封面下方的留白原本是 `vh` 派生的，设备框里没有对应的量；
 * 这里声明一个模拟高度并写在预览条上，不让它们继续按管理员窗口的高度变化。
 */
export const PREVIEW_DEVICE_HEIGHT = {
  desktop: 900,
  mobile: 844,
} as const

/**
 * 画布 → 设备框的等比例缩放系数。
 *
 * @param available 画布可用宽度（px）
 * @param logical 设备框的逻辑宽度（px）
 * @returns 不超过 1 的系数：装得下就是 1（不放大），装不下按比例缩小
 */
export function previewScale(available: number, logical: number): number {
  if (!Number.isFinite(available) || !Number.isFinite(logical)) return 1
  if (available <= 0 || logical <= 0) return 1
  return Math.min(1, available / logical)
}
