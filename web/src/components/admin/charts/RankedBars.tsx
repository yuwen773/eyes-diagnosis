import type { ReactElement } from "react"
import type { Ranked } from "@/lib/adminDomain"
import { useMeasuredWidth } from "./useMeasuredWidth"
import {
  RANK_BAR_H as RB_BAR_H,
  RANK_MIN_W as RB_MIN_W,
  RANK_PAD_Y as RB_PAD_Y,
  RANK_ROW_H as RB_ROW_H,
  RANK_TICKS as RB_TICKS,
  rankedGeometry,
} from "./chartGeometry"
import {
  ChartView,
  formatVizNumber,
  formatVizPercent,
  rightRoundedBarPath,
} from "./TrendChart"

/* ── 排序横条几何：viewBox 把「名称带 / 刻度轨 / 数值+占比带」全部算进去，
 * 容器不裁轴。逻辑宽取容器实测宽（见 useMeasuredWidth）→ 缩放比恒为 1，
 * 名称与数值带保持设计字号，刻度轨随容器变长；行高是逻辑单位，恒为 40px。
 * 几何计算见 chartGeometry.ts（纯函数，有单测钉住）。
 * 刻度轨同构复刻 app.css 的 .scale__track / .scale__ticks 词汇（发丝轨 +
 * 无字刻度），另起 admin-viz__rank-* 命名空间，不污染全站判读页的尺子。
 * ───────────────────────────────────────────────────────────────────────── */

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
  const { ref: figureRef, width } = useMeasuredWidth<HTMLDivElement>(RB_MIN_W)

  // 逻辑宽 = 容器实测宽：名称带 / 数值带固定，刻度轨吃掉余量。
  // 轨道末与数值列留 48px：数值是 4~5 位 mono 数字（约 32px 宽），
  // 只留 16px 会被最长那根条顶到数字上（数值右对齐，文字往左探）。
  const { height, trackX0: rbTrackX0, trackX1: rbTrackX1, trackW: rbTrackW, valueX: rbValueX, shareX: rbShareX } =
    rankedGeometry(width, rows.length)
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
      ref={figureRef}
      tabIndex={0}
      role="group"
      aria-label={`${ariaLabel}，按数值降序：${readout || "暂无数据"}`}
    >
      <svg
        className="admin-viz__svg"
        viewBox={`0 0 ${width} ${height}`}
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
