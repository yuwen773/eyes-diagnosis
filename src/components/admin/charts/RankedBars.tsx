import type { ReactElement } from "react"
import type { Ranked } from "@/lib/adminDomain"
import {
  ChartView,
  formatVizNumber,
  formatVizPercent,
  rightRoundedBarPath,
} from "./TrendChart"

/* ── 排序横条几何：viewBox 把「名称带 / 刻度轨 / 数值+占比带」全部算进去，
 * 容器不裁轴；SVG width:100% + height:auto 由 viewBox 自适应宽度。
 * 刻度轨同构复刻 app.css 的 .scale__track / .scale__ticks 词汇（发丝轨 +
 * 无字刻度），另起 admin-viz__rank-* 命名空间，不污染全站判读页的尺子。
 * ───────────────────────────────────────────────────────────────────────── */
const RB_W = 640
const RB_ROW_H = 40
const RB_PAD_Y = 12
const RB_NAME_W = 168
const RB_RIGHT_PAD = 16
const RB_SHARE_W = 64
const RB_BAR_H = 12
const RB_TICKS = 5

const rbTrackX0 = RB_NAME_W + 12
const rbShareX = RB_W - RB_RIGHT_PAD
const rbValueX = rbShareX - RB_SHARE_W - 16
const rbTrackX1 = rbValueX - 16
const rbTrackW = rbTrackX1 - rbTrackX0

/**
 * 排序横条（疾病分布，饼图撤掉后的替代）：名称（--fg-2，恒在条外左侧）+
 * 刻度轨横条（--viz-accent，数据端 4px 圆角 / 基线端方角）+ 数值与占比 mono
 * （--fg）。配 ChartView 的「图 / 表」切换，占比与数值常驻读数表，不依赖 tooltip。
 *
 * barLabelFits 不适用：本设计名称恒在条外左侧，绝不把名称放进条内，
 * 故无需守卫「条内标签放不放得下」（brief 裁定不 import，仅此说明）。
 *
 * 键盘可达（选「整图 tabIndex=0」）：排序条无准线 / 逐点 tooltip，整图作单一
 * tab 站，aria-label 顺序播报全部读数，数据另由「图 / 表」读数表常驻提供；
 * hover 微亮仅为装饰，不承担读数职责。
 */
export function RankedBars(props: {
  rows: Ranked[]
  ariaLabel: string
}): ReactElement {
  const { rows, ariaLabel } = props
  const height = RB_PAD_Y * 2 + Math.max(rows.length, 1) * RB_ROW_H
  const leading = Math.max(0, ...rows.map((row) => row.value))
  const readout = rows
    .map(
      (row) =>
        `${row.name} ${formatVizNumber(row.value)} ${formatVizPercent(row.share)}`,
    )
    .join("，")

  const figure = (
    <div
      className="admin-viz__figure admin-viz__figure--static"
      tabIndex={0}
      role="group"
      aria-label={`${ariaLabel}，按数值降序：${readout || "暂无数据"}`}
    >
      <svg
        className="admin-viz__svg"
        viewBox={`0 0 ${RB_W} ${height}`}
        aria-hidden="true"
      >
        {rows.map((row, i) => {
          const cy = RB_PAD_Y + i * RB_ROW_H + RB_ROW_H / 2
          const ratio = leading > 0 ? Math.max(0, row.value) / leading : 0
          const barW = ratio * rbTrackW
          return (
            <g className="admin-viz__rank-row" key={`${row.name}-${i}`}>
              {/* 名称恒在条外左侧（--fg-2），不进条内 */}
              <text
                className="admin-viz__rank-name"
                x={rbTrackX0 - 12}
                y={cy}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {row.name}
              </text>

              {/* 刻度轨：1px 实线发丝轨（--hr）+ 无字刻度（--hr-strong） */}
              <line
                className="admin-viz__rule"
                x1={rbTrackX0}
                x2={rbTrackX1}
                y1={cy + RB_BAR_H / 2}
                y2={cy + RB_BAR_H / 2}
              />
              {Array.from({ length: RB_TICKS }, (_, t) => {
                const tx = rbTrackX0 + (t / (RB_TICKS - 1)) * rbTrackW
                return (
                  <line
                    key={t}
                    className="admin-viz__rank-tick"
                    x1={tx}
                    x2={tx}
                    y1={cy - RB_BAR_H / 2}
                    y2={cy + RB_BAR_H / 2}
                  />
                )
              })}

              {/* 数据条：单色 --viz-accent，数据端圆角 / 基线端方角 */}
              <path
                className="admin-viz__rank-fill"
                d={rightRoundedBarPath(
                  rbTrackX0,
                  cy - RB_BAR_H / 2,
                  barW,
                  RB_BAR_H,
                )}
              />

              {/* 数值 + 占比：均 mono、--fg，文字不穿数据色 */}
              <text
                className="admin-viz__rank-value num"
                x={rbValueX}
                y={cy}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {formatVizNumber(row.value)}
              </text>
              <text
                className="admin-viz__rank-share num"
                x={rbShareX}
                y={cy}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {formatVizPercent(row.share)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )

  return (
    <ChartView
      title={ariaLabel}
      ariaLabel={ariaLabel}
      labelHeader="类别"
      extraHeader="占比"
      rows={rows.map((row) => ({
        label: row.name,
        value: formatVizNumber(row.value),
        extra: formatVizPercent(row.share),
      }))}
      figure={figure}
    />
  )
}
