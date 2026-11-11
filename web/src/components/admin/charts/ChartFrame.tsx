import { useState, type ReactElement, type ReactNode } from "react"

/**
 * 图表外壳：图 / 表 切换 + 常驻读数表 + 共享的 tooltip 与配色。
 *
 * <p>硬条款：tooltip 不得是唯一读数通道。每张图都配一张 label/value（+占比）
 * 读数表，读者不碰鼠标也能读到全部数值；键盘用户读同一张表。
 *
 * <p>配色只吃上下文令牌（--signal / --fg-* / --hr / --surface），
 * SVG 的 fill/stroke 直接写 var(...)，双主题自动翻，不写死色值。
 */

/** 读数格式化：非有限值给破折号，有限值原样直出（不擅自补小数）。 */
export function formatVizNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : "—"
}

/** 占比：share ∈ [0,1] → 一位小数百分比。 */
export function formatVizPercent(share: number): string {
  return Number.isFinite(share) ? `${(share * 100).toFixed(1)}%` : "—"
}

/** 图表配色：全部引用 CSS 变量，深色主题自动跟随。 */
export const VIZ = {
  /** 强调（信号橙）：只给「当前要处理的重点」用，不做大面积填充。 */
  accent: "var(--signal)",
  /** 去强调的墨色：次要系列、参考线。 */
  mute: "var(--viz-mute)",
  /** 网格与轴：1px 实线发丝。 */
  rule: "var(--hr)",
  /** 轴刻度文字。 */
  axisText: "var(--fg-3)",
  /** 表面色（tooltip 底、环）。 */
  surface: "var(--surface)",
} as const

/** 坐标轴文字的统一字号与字族：等宽数字 + tabular-nums。 */
export const VIZ_AXIS_TICK = {
  fill: VIZ.axisText,
  fontSize: 11,
  fontFamily: "var(--font-mono)",
} as const

export type ReadoutRow = { label: string; value: string; extra?: string }

/**
 * 图 / 表 切换器 + mono 读数表。
 * 视图状态局部，不外泄、不内置数据。
 */
export function ChartView(props: {
  title: string
  ariaLabel: string
  labelHeader: string
  extraHeader?: string
  rows: ReadoutRow[]
  figure: ReactNode
  headExtra?: ReactNode
}): ReactElement {
  const { title, ariaLabel, labelHeader, extraHeader, rows, figure, headExtra } = props
  const [view, setView] = useState<"chart" | "table">("chart")
  const hasExtra = rows.some((row) => row.extra !== undefined)

  let body: ReactNode
  if (rows.length === 0) {
    body = <p className="admin-viz__empty">暂无数据</p>
  } else if (view === "chart") {
    body = figure
  } else {
    body = (
      <table className="admin-viz__table num" aria-label={`${ariaLabel} · 读数表`}>
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
                <td className="admin-viz__td admin-viz__td--extra">{row.extra ?? "—"}</td>
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
        {headExtra ? <span className="admin-viz__head-extra num">{headExtra}</span> : null}
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

/** Recharts 的 tooltip 入参（只用到这几个字段）。 */
type TooltipPayloadItem = { name?: string | number; value?: number | string; color?: string }
export type VizTooltipProps = {
  active?: boolean
  label?: string | number
  payload?: TooltipPayloadItem[]
  /** 读数表里「数值」那一列的表头，用作 tooltip 的单位说明 */
  unit?: string
}

/**
 * 统一的 tooltip：纸面 + 发丝边框，label 用 --fg-2，数值用 --fg 等宽。
 *
 * <p>tooltip 只是快捷通道，读数表里始终有同样的数字（见 ChartView）。
 */
export function VizTooltip({ active, label, payload, unit }: VizTooltipProps): ReactElement | null {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="admin-viz__tip" role="presentation">
      <span className="admin-viz__tip-label">{label}</span>
      {payload.map((item, index) => (
        <span className="admin-viz__tip-row" key={`${item.name}-${index}`}>
          <span className="admin-viz__tip-name">{item.name}</span>
          <span className="admin-viz__tip-value num">
            {formatVizNumber(Number(item.value ?? 0))}
            {unit ? ` ${unit}` : ""}
          </span>
        </span>
      ))}
    </div>
  )
}
