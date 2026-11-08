import type { ReactElement } from "react"
import { formatVizNumber, topRoundedBarPath } from "./TrendChart"

/* ── 小倍数柱图几何：无轴（仅一条 1px 实线基线，无刻度/无轴标签）──────────── */
const MB_W = 200
const MB_H = 64
const MB_PAD = 7
const MB_BAR_W = 18 // ≤24px；数据端 4px 圆角，基线端方角

/**
 * 小倍数单元格（迷你柱图）：标题（--fg-2 小字）+ 无轴柱图 + 末值 mono。
 * 单色 --viz-mute，最大值柱用 --viz-accent；柱宽 18px ≤24px。
 * SVG <rect rx> 四角全圆，这里用 topRoundedBarPath 只圆顶部两角、基线端方角。
 *
 * 键盘可达：整格 tabIndex=0（选「整图聚焦」而非逐柱聚焦——无轴小倍数每柱
 * 一个 tab 站没有读数收益；aria-label 顺序播报全部 label:value，读数本身由
 * 柱高 + aria-label 常驻可得，不依赖 tooltip）。
 */
export function MiniBars(props: {
  title: string
  bars: { label: string; value: number }[]
}): ReactElement {
  const { title, bars } = props
  const n = bars.length
  const values = bars.map((bar) => (Number.isFinite(bar.value) ? bar.value : 0))
  const max = Math.max(0, ...values)
  const bandW = (MB_W - 2 * MB_PAD) / Math.max(n, 1)
  const baseline = MB_H - MB_PAD
  const plotH = MB_H - 2 * MB_PAD
  const last = n > 0 ? bars[n - 1].value : undefined
  const lastValue = last !== undefined ? formatVizNumber(last) : "—"
  const readout = bars
    .map((bar) => `${bar.label} ${formatVizNumber(bar.value)}`)
    .join("，")

  return (
    <div
      className="admin-viz__mini"
      tabIndex={0}
      role="group"
      aria-label={`${title}，末值 ${lastValue}，各柱读数：${readout || "暂无数据"}`}
    >
      <span className="admin-viz__mini-title">{title}</span>
      <svg
        className="admin-viz__mini-svg"
        viewBox={`0 0 ${MB_W} ${MB_H}`}
        aria-hidden="true"
      >
        {/* 基线：1px 实线发丝（--hr），无刻度无轴标签，不算坐标轴 */}
        <line
          className="admin-viz__rule"
          x1={MB_PAD}
          x2={MB_W - MB_PAD}
          y1={baseline}
          y2={baseline}
        />
        {bars.map((bar, i) => {
          const h = max > 0 ? (values[i] / max) * plotH : 0
          const x = MB_PAD + i * bandW + (bandW - MB_BAR_W) / 2
          const isMax = max > 0 && values[i] === max
          return (
            <path
              key={`${bar.label}-${i}`}
              className={
                "admin-viz__mini-bar" +
                (isMax ? " admin-viz__mini-bar--max" : "")
              }
              d={topRoundedBarPath(x, baseline - h, MB_BAR_W, h)}
            />
          )
        })}
      </svg>
      <span className="admin-viz__mini-value num">{lastValue}</span>
    </div>
  )
}
