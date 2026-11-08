import { useRef, useState } from "react"
import type { KeyboardEvent, ReactElement, ReactNode } from "react"

/* ─────────────────────────────────────────────────────────────────────────────
 * 本文件除 TrendChart 外，还导出图表段共用件（ChartView / 数值格式 / 圆角柱路径）。
 * 沿用 Task 4「Modal 导出 useAdminDialog、Drawer 复用」的约定：brief 只列四个
 * 组件文件，共用件不另起第五个文件。
 * ─────────────────────────────────────────────────────────────────────────── */

/** 读数格式化：非有限值给破折号，有限值原样直出（不擅自补小数）。 */
export function formatVizNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : "—"
}

/** 占比：share ∈ [0,1] → 一位小数百分比。 */
export function formatVizPercent(share: number): string {
  return Number.isFinite(share) ? `${(share * 100).toFixed(1)}%` : "—"
}

/** 轴刻度去浮点毛刺（0.30000000000000004 → 0.3）。 */
function cleanTick(value: number): string {
  return String(Number(value.toFixed(6)))
}

const clamp = (value: number, lo: number, hi: number): number =>
  Math.min(Math.max(value, lo), hi)

/**
 * 数据端（顶部）4px 圆角、基线端方角的竖直柱路径。
 * SVG <rect rx> 会四角全圆，这里用 path 只圆顶部两角；半径同时受柱宽/柱高
 * 截断，矮柱不会出现负半径或自交。
 */
export function topRoundedBarPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r = 4,
): string {
  if (h <= 0 || w <= 0) return ""
  const rad = Math.min(r, w / 2, h)
  return [
    `M ${x} ${y + h}`,
    `L ${x} ${y + rad}`,
    `Q ${x} ${y} ${x + rad} ${y}`,
    `L ${x + w - rad} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + rad}`,
    `L ${x + w} ${y + h}`,
    "Z",
  ].join(" ")
}

/** 数据端（右侧）4px 圆角、基线端（左侧）方角的横条路径，与上者同构。 */
export function rightRoundedBarPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r = 4,
): string {
  if (h <= 0 || w <= 0) return ""
  const rad = Math.min(r, h / 2, w)
  return [
    `M ${x} ${y}`,
    `L ${x + w - rad} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + rad}`,
    `L ${x + w} ${y + h - rad}`,
    `Q ${x + w} ${y + h} ${x + w - rad} ${y + h}`,
    `L ${x} ${y + h}`,
    "Z",
  ].join(" ")
}

export type ReadoutRow = { label: string; value: string; extra?: string }

/**
 * 图 / 表 切换器 + mono 读数表。
 * dataviz 硬条款：tooltip 不得是唯一读数通道——每张 TrendChart / RankedBars
 * 都配一张 label/value（+占比）读数表。视图状态局部，不外泄、不内置数据。
 */
export function ChartView(props: {
  title: string
  ariaLabel: string
  labelHeader: string
  extraHeader?: string
  rows: ReadoutRow[]
  figure: ReactNode
}): ReactElement {
  const { title, ariaLabel, labelHeader, extraHeader, rows, figure } = props
  const [view, setView] = useState<"chart" | "table">("chart")
  const hasExtra = rows.some((row) => row.extra !== undefined)

  let body: ReactNode
  if (rows.length === 0) {
    body = <p className="admin-viz__empty">暂无数据</p>
  } else if (view === "chart") {
    body = figure
  } else {
    body = (
      <table
        className="admin-viz__table num"
        aria-label={`${ariaLabel} · 读数表`}
      >
        <thead>
          <tr>
            <th className="admin-viz__th" scope="col">
              {labelHeader}
            </th>
            <th className="admin-viz__th admin-viz__th--right" scope="col">
              数值
            </th>
            {hasExtra ? (
              <th className="admin-viz__th admin-viz__th--right" scope="col">
                {extraHeader ?? "占比"}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.label}-${index}`} className="admin-viz__tr">
              <th className="admin-viz__td admin-viz__td--label" scope="row">
                {row.label}
              </th>
              <td className="admin-viz__td admin-viz__td--value">{row.value}</td>
              {hasExtra ? (
                <td className="admin-viz__td admin-viz__td--extra">
                  {row.extra ?? "—"}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <section className="admin-viz" aria-label={ariaLabel}>
      <div className="admin-viz__head">
        <span className="admin-viz__title">{title}</span>
        <div
          className="admin-viz__toggle"
          role="group"
          aria-label={`${ariaLabel} 视图切换`}
        >
          <button
            type="button"
            className="admin-viz__toggle-btn"
            aria-pressed={view === "chart"}
            onClick={() => setView("chart")}
          >
            图
          </button>
          <button
            type="button"
            className="admin-viz__toggle-btn"
            aria-pressed={view === "table"}
            onClick={() => setView("table")}
          >
            表
          </button>
        </div>
      </div>
      <div className="admin-viz__body">{body}</div>
    </section>
  )
}

/* ── TrendChart 几何 ───────────────────────────────────────────────────────
 * viewBox 把 Y 轴刻度带（左 48）、X 轴标签带（下 32）、端点直标带（右 76）
 * 全部算进去，容器不裁轴；SVG width:100% + height:auto 由 viewBox 自适应宽度。
 * ───────────────────────────────────────────────────────────────────────── */
const VW = 640
const VH = 240
const PAD = { left: 48, right: 76, top: 18, bottom: 32 }
const plotX0 = PAD.left
const plotX1 = VW - PAD.right
const plotY0 = PAD.top
const plotY1 = VH - PAD.bottom
const plotW = plotX1 - plotX0
const plotH = plotY1 - plotY0
const TIP_W = 128
const TIP_H = 48

type YAxis = { min: number; max: number; ticks: number[] }
const NICE_MULTIPLES = [1, 2, 2.5, 5, 10]

/**
 * 取 1/2/2.5/5/10 × 10^k 的刻度步长，使 Y 轴网格线恒为 3–5 条。
 * 候选里优先 4 条，其次「刻度跨度 − 数据跨度」最小（刻度不空占版面）。
 */
function computeYAxis(values: number[]): YAxis {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) return { min: 0, max: 1, ticks: [0, 0.5, 1] }

  let dmin = Math.min(...finite)
  let dmax = Math.max(...finite)
  if (dmin === dmax) {
    const pad = Math.abs(dmin) > 0 ? Math.abs(dmin) * 0.1 : 1
    dmin -= pad
    dmax += pad
  }
  // 全为非负读数时不让网格掉到 0 以下（计数类趋势不该出现负值刻度）。
  if (finite.every((v) => v >= 0)) dmin = Math.max(0, dmin)
  const span = dmax - dmin

  let best: YAxis = { min: dmin, max: dmax, ticks: [dmin, (dmin + dmax) / 2, dmax] }
  let bestScore = Number.POSITIVE_INFINITY
  for (let k = -9; k <= 15; k += 1) {
    for (const m of NICE_MULTIPLES) {
      const step = m * 10 ** k
      const lo = Math.floor(dmin / step - 1e-9) * step
      const hi = Math.ceil(dmax / step + 1e-9) * step
      const count = Math.round((hi - lo) / step) + 1
      if (count < 3 || count > 5) continue
      const ticks = Array.from(
        { length: count },
        (_, i) => Number((lo + i * step).toFixed(6)),
      )
      const score = Math.abs(count - 4) * 1000 + (hi - lo - span)
      if (score < bestScore) {
        bestScore = score
        best = { min: lo, max: hi, ticks }
      }
    }
  }
  return best
}

/**
 * 单系列趋势折线：2px 圆头折线 + 同色 10% 面积淡填 + 十字准线 tooltip +
 * 端点直标 + 3–5 条 1px 实线发丝网格，无图例（标题即说明）。
 * 命中层是覆盖整图的透明层，按最近数据点取整，等价于「整列宽命中」；
 * 同一个层 tabIndex=0，onFocus/onBlur + 左右方向键与 hover 同效。
 */
export function TrendChart(props: {
  points: { label: string; value: number }[]
  ariaLabel: string
}): ReactElement {
  const { points, ariaLabel } = props
  const [active, setActive] = useState<number | null>(null)
  const figureRef = useRef<HTMLDivElement>(null)

  const n = points.length
  const axis = computeYAxis(points.map((p) => p.value))
  const safe = (v: number): number => (Number.isFinite(v) ? v : axis.min)
  const xAt = (i: number): number =>
    n <= 1 ? plotX0 + plotW / 2 : plotX0 + (i * plotW) / (n - 1)
  const yAt = (v: number): number =>
    plotY1 - ((safe(v) - axis.min) / (axis.max - axis.min)) * plotH

  const coords = points.map((p, i) => ({ x: xAt(i), y: yAt(p.value) }))
  const linePath = coords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`)
    .join(" ")
  const areaPath =
    n >= 2
      ? `${linePath} L ${coords[n - 1].x} ${plotY1} L ${coords[0].x} ${plotY1} Z`
      : ""

  // 鼠标 X → viewBox X → 最近数据点索引（边界落在两列中点，即整列宽命中）。
  const handlePointer = (clientX: number): void => {
    const box = figureRef.current?.getBoundingClientRect()
    if (!box || box.width === 0 || n === 0) return
    const vx = ((clientX - box.left) / box.width) * VW
    const index =
      n <= 1
        ? 0
        : clamp(Math.round(((vx - plotX0) / plotW) * (n - 1)), 0, n - 1)
    setActive(index)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (n === 0) return
    const current = active ?? 0
    let next: number
    switch (event.key) {
      case "ArrowLeft":
        next = current - 1
        break
      case "ArrowRight":
        next = current + 1
        break
      case "Home":
        next = 0
        break
      case "End":
        next = n - 1
        break
      default:
        return
    }
    event.preventDefault()
    setActive(clamp(next, 0, n - 1))
  }

  const activePoint = active !== null ? points[active] : undefined
  const activeCoord = active !== null ? coords[active] : undefined
  const tipX = activeCoord
    ? clamp(activeCoord.x + 14, plotX0, plotX1 - TIP_W)
    : 0
  const tipY = activeCoord
    ? clamp(activeCoord.y - TIP_H - 14, plotY0, plotY1 - TIP_H)
    : 0

  const figure = (
    <div className="admin-viz__figure" ref={figureRef}>
      <svg
        className="admin-viz__svg"
        viewBox={`0 0 ${VW} ${VH}`}
        aria-hidden="true"
      >
        {/* Y 轴网格：1px 实线发丝（--hr），无虚线；刻度文字用文本令牌。 */}
        {axis.ticks.map((tick) => (
          <g key={tick}>
            <line
              className="admin-viz__rule"
              x1={plotX0}
              x2={plotX1}
              y1={yAt(tick)}
              y2={yAt(tick)}
            />
            <text
              className="admin-viz__axis-text"
              x={plotX0 - 10}
              y={yAt(tick)}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {cleanTick(tick)}
            </text>
          </g>
        ))}

        {/* X 轴基线 + 标签带（算在 viewBox 内，容器不裁） */}
        <line
          className="admin-viz__rule"
          x1={plotX0}
          x2={plotX1}
          y1={plotY1}
          y2={plotY1}
        />
        {coords.map((c, i) => (
          <text
            key={`${points[i].label}-${i}`}
            className="admin-viz__axis-text"
            x={c.x}
            y={plotY1 + 17}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {points[i].label}
          </text>
        ))}

        {/* 标记：同色 10% 面积淡填 + 2px round join/cap 折线 */}
        {areaPath ? <path className="admin-viz__area" d={areaPath} /> : null}
        {n >= 2 ? <path className="admin-viz__line" d={linePath} /> : null}

        {/* 端点直标：≥8px 带 2px surface 环的标记 + 最后一个值（强元素） */}
        {n > 0 ? (
          <g>
            <circle
              className="admin-viz__dot"
              cx={coords[n - 1].x}
              cy={coords[n - 1].y}
              r={5}
            />
            <text
              className="admin-viz__end-label"
              x={coords[n - 1].x + 11}
              y={coords[n - 1].y}
              dominantBaseline="middle"
            >
              {formatVizNumber(points[n - 1].value)}
            </text>
          </g>
        ) : null}

        {/* 十字准线（跟随最近数据点）：竖线整列 + 横线，均 1px 实线 */}
        {activeCoord ? (
          <g>
            <line
              className="admin-viz__crosshair"
              x1={activeCoord.x}
              x2={activeCoord.x}
              y1={plotY0}
              y2={plotY1}
            />
            <line
              className="admin-viz__crosshair"
              x1={plotX0}
              x2={plotX1}
              y1={activeCoord.y}
              y2={activeCoord.y}
            />
            <circle
              className="admin-viz__dot"
              cx={activeCoord.x}
              cy={activeCoord.y}
              r={5}
            />
          </g>
        ) : null}

        {/* tooltip：label（--fg-2）+ value（--fg，强元素） */}
        {activePoint && activeCoord ? (
          <g transform={`translate(${tipX}, ${tipY})`}>
            <rect
              className="admin-viz__tip-box"
              width={TIP_W}
              height={TIP_H}
            />
            <text className="admin-viz__tip-label" x={12} y={18}>
              {activePoint.label}
            </text>
            <text className="admin-viz__tip-value" x={12} y={37}>
              {formatVizNumber(activePoint.value)}
            </text>
          </g>
        ) : null}
      </svg>

      <div
        className="admin-viz__hit"
        tabIndex={0}
        role="group"
        aria-label={`${ariaLabel}，左右方向键查看各点读数`}
        onFocus={() => setActive(n > 0 ? 0 : null)}
        onBlur={() => setActive(null)}
        onKeyDown={handleKeyDown}
        onMouseMove={(event) => handlePointer(event.clientX)}
        onMouseLeave={() => setActive(null)}
      />

      {/* 键盘读数播报：focus 与 hover 同效，值不是 tooltip 独占 */}
      <span className="admin-viz__sr-only" aria-live="polite">
        {activePoint
          ? `${activePoint.label}：${formatVizNumber(activePoint.value)}`
          : ""}
      </span>
    </div>
  )

  return (
    <ChartView
      title={ariaLabel}
      ariaLabel={ariaLabel}
      labelHeader="标签"
      rows={points.map((p) => ({
        label: p.label,
        value: formatVizNumber(p.value),
      }))}
      figure={figure}
    />
  )
}
