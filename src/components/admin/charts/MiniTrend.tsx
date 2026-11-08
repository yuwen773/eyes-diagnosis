import type { ReactElement } from "react"
import { formatVizNumber } from "./TrendChart"

/* ── 小倍数折线几何：无轴，viewBox 自适应宽度 ────────────────────────────── */
const MT_W = 200
const MT_H = 64
const MT_PAD = 7

/**
 * 小倍数单元格（迷你折线）：标题（--fg-2 小字）+ 无轴折线（--viz-mute）+
 * 末点 --viz-accent 标记 + 末值 mono。身份由小标题承担，6 系列不挤一张图。
 *
 * 键盘可达：整格 tabIndex=0（选「整图聚焦」而非逐点聚焦——无轴小倍数不提供
 * 逐点读数，逐点焦点会给出无意义的 tab 站；整格聚焦由 aria-label 播报标题与
 * 末值，读数本身以 mono 数字常驻可见）。
 */
export function MiniTrend(props: {
  title: string
  points: number[]
}): ReactElement {
  const { title, points } = props
  const finite = points.filter((v) => Number.isFinite(v))
  const dmin = finite.length > 0 ? Math.min(...finite) : 0
  const dmax = finite.length > 0 ? Math.max(...finite) : 1
  const span = dmax - dmin || 1
  const n = points.length

  const xAt = (i: number): number =>
    n <= 1
      ? MT_W / 2
      : MT_PAD + (i * (MT_W - 2 * MT_PAD)) / (n - 1)
  const yAt = (v: number): number =>
    MT_H -
    MT_PAD -
    ((Number.isFinite(v) ? v - dmin : 0) / span) * (MT_H - 2 * MT_PAD)
  const coords = points.map((v, i) => ({ x: xAt(i), y: yAt(v) }))
  const linePath = coords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`)
    .join(" ")
  const last = n > 0 ? points[n - 1] : undefined
  const lastCoord = n > 0 ? coords[n - 1] : undefined
  const lastValue = last !== undefined ? formatVizNumber(last) : "—"

  return (
    <div
      className="admin-viz__mini"
      tabIndex={0}
      role="group"
      aria-label={`${title}，末值 ${lastValue}`}
    >
      <span className="admin-viz__mini-title">{title}</span>
      <svg
        className="admin-viz__mini-svg"
        viewBox={`0 0 ${MT_W} ${MT_H}`}
        aria-hidden="true"
      >
        {n >= 2 ? <path className="admin-viz__mini-line" d={linePath} /> : null}
        {lastCoord ? (
          <circle
            className="admin-viz__mini-dot"
            cx={lastCoord.x}
            cy={lastCoord.y}
            r={3.5}
          />
        ) : null}
      </svg>
      <span className="admin-viz__mini-value num">{lastValue}</span>
    </div>
  )
}
