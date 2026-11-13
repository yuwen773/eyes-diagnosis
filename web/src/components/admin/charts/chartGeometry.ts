/**
 * 手写 SVG 图表的几何计算（纯函数，无 DOM 依赖）。
 *
 * 四张图共用一条规矩：**逻辑宽 = 容器实测 CSS 像素宽**（见 useMeasuredWidth），
 * 于是 viewBox 与渲染尺寸 1:1，缩放比恒为 1——卡片变宽时得到的是更长的
 * 绘图区，而不是被整体放大的坐标轴文字（放大到 20px 就不是仪表读数了）。
 *
 * 逻辑高随宽度走并封顶：图形变宽时不至于被拉成一条扁带。
 */

/* ── 趋势折线（TrendChart）────────────────────────────────────────────── */

export const TREND_VW_MIN = 320
export const TREND_VH_MIN = 240
export const TREND_VH_MAX = 360
/** 轴带：左=Y 刻度，右=端点直标，下=X 标签，上=顶部余量。 */
export const TREND_PAD = { left: 48, right: 76, top: 18, bottom: 32 }
/** X 轴标签之间的最小净距（1:1 渲染，窄容器里 7 个「周一…周日」会挤成一团）。 */
export const TREND_MIN_LABEL_GAP = 46

export type TrendGeometry = {
  vw: number
  vh: number
  plotX0: number
  plotX1: number
  plotY0: number
  plotY1: number
  plotW: number
  plotH: number
}

/**
 * 由逻辑宽推出趋势图几何。
 * 逻辑高 = clamp(逻辑宽 × 0.34, 240, 360)；绘图区 = 逻辑尺寸 − 四边轴带。
 */
export function trendGeometry(vw: number): TrendGeometry {
  const vh = Math.round(Math.min(TREND_VH_MAX, Math.max(TREND_VH_MIN, vw * 0.34)))
  const plotX0 = TREND_PAD.left
  const plotX1 = vw - TREND_PAD.right
  const plotY0 = TREND_PAD.top
  const plotY1 = vh - TREND_PAD.bottom
  return {
    vw,
    vh,
    plotX0,
    plotX1,
    plotY0,
    plotY1,
    plotW: plotX1 - plotX0,
    plotH: plotY1 - plotY0,
  }
}

/* ── 排序横条（RankedBars）───────────────────────────────────────────── */

/**
 * X 轴标签抽稀步长：按标签最小净距算，隔一个画一个。
 * 末点标签始终保留（读者要看到最新一格），故步长只影响中间那些点。
 */
export function trendLabelStep(plotW: number, pointCount: number): number {
  if (pointCount <= 1) return 1
  const spacing = Math.max(plotW / (pointCount - 1), 1)
  return Math.max(1, Math.ceil(TREND_MIN_LABEL_GAP / spacing))
}
export const RANK_MIN_W = 480
export const RANK_ROW_H = 40
export const RANK_PAD_Y = 12
export const RANK_NAME_W = 168
export const RANK_RIGHT_PAD = 16
export const RANK_SHARE_W = 64
export const RANK_BAR_H = 12
export const RANK_TICKS = 5
/**
 * 轨道末与数值列右缘的净距。数值是 4~5 位 mono 数字（约 32px 宽，右对齐），
 * 只留 16px 会被最长那根条顶到数字上。
 */
export const RANK_VALUE_CLEARANCE = 48

export type RankedGeometry = {
  /** 逻辑宽（= 容器实测宽）。 */
  w: number
  /** 行块总高：上下留白 + 每行 40px。 */
  height: number
  /** 刻度轨左缘 / 右缘。 */
  trackX0: number
  trackX1: number
  trackW: number
  /** 数值列右缘（数值右对齐于此）。 */
  valueX: number
  /** 占比列右缘（占比右对齐于此）。 */
  shareX: number
}

/** 由逻辑宽推出排序横条几何：名称带 / 数值带固定，刻度轨吃掉余量。 */
export function rankedGeometry(w: number, rowCount: number): RankedGeometry {
  const trackX0 = RANK_NAME_W + 12
  const shareX = w - RANK_RIGHT_PAD
  const valueX = shareX - RANK_SHARE_W - 16
  const trackX1 = valueX - RANK_VALUE_CLEARANCE
  return {
    w,
    height: RANK_PAD_Y * 2 + Math.max(rowCount, 1) * RANK_ROW_H,
    trackX0,
    trackX1,
    trackW: trackX1 - trackX0,
    valueX,
    shareX,
  }
}

/* ── 小倍数（MiniTrend / MiniBars）────────────────────────────────────── */

export const MINI_MIN_W = 160
export const MINI_H_MIN = 64
export const MINI_H_MAX = 120
export const MINI_PAD = 7

export type MiniGeometry = {
  w: number
  h: number
  pad: number
}

/** 由逻辑宽推出小倍数几何：逻辑高 = clamp(宽 × 0.3, 64, 120)。 */
export function miniGeometry(w: number): MiniGeometry {
  return {
    w,
    h: Math.round(Math.min(MINI_H_MAX, Math.max(MINI_H_MIN, w * 0.3))),
    pad: MINI_PAD,
  }
}
