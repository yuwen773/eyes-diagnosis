import type { ReactElement } from "react"
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts"

import { VIZ, VizTooltip, formatVizNumber, vizSeriesColor } from "./ChartFrame"

/**
 * 统一尺度的小倍数（病种日趋势）。
 *
 * <p>关键约束：所有小倍数共用同一个 Y 上限（domainMax）。各病种各画各的
 * 归一化折线时，日增 2 条的病种和日增 200 条的病种看起来一样高——那是假的。
 * 共用尺度之后，「哪个病种在涨」才是能直接比出来的。
 *
 * <p>读数给的是**窗口内合计**而不是「最后一天的值」：窗口末尾常常落在一个
 * 没有判读的日子上，末值读数会集体显示 0，看起来像这批病种一夜清零。
 * 合计是这段趋势真正的主读数；峰值与日均作为脚注补充。
 *
 * <p>颜色不是唯一信息载体：每格带短码、中文名、合计读数与峰值/日均脚注，
 * 键盘读到格就播报同样的内容。
 */
export function SmallMultipleTrend(props: {
  title: string
  /** 规范短码（如 CAT / DR）：与记录纸上的短码同源 */
  code?: string
  points: number[]
  /** 与其它小倍数共用的 Y 上限 */
  domainMax: number
  labels?: string[]
  /** 分类色序号：同一病种在分布图与趋势图里用同一种颜色。 */
  colorIndex?: number
  /** 窗口内合计 */
  total?: number
  /** 窗口天数（用于日均口径） */
  windowDays?: number
}): ReactElement {
  const { title, code, points, domainMax, labels, colorIndex = 0, total, windowDays } = props
  const peak = points.length > 0 ? Math.max(...points) : undefined
  const sum = total ?? points.reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0)
  const average = windowDays && windowDays > 0 ? sum / windowDays : null
  const data = points.map((value, index) => ({
    label: labels?.[index] ?? String(index + 1),
    value,
  }))

  const readout =
    `窗口内合计 ${formatVizNumber(sum)}，峰值 ${formatVizNumber(peak ?? NaN)}` +
    (average !== null ? `，日均 ${formatVizNumber(Number(average.toFixed(2)))}` : "")

  return (
    <div className="admin-viz__mini" tabIndex={0} role="group" aria-label={`${title}，${readout}`}>
      <div className="admin-viz__mini-head">
        {code ? <span className="admin-viz__mini-code num">{code}</span> : null}
        <span className="admin-viz__mini-title" title={title}>
          {title}
        </span>
        <span className="admin-viz__mini-total num">{formatVizNumber(sum)}</span>
      </div>
      <div className="admin-viz__mini-svg">
        <ResponsiveContainer width="100%" height={64}>
          <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 2, left: 4 }}>
            <defs>
              <linearGradient id={`iris-mini-${colorIndex}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={vizSeriesColor(colorIndex)} stopOpacity={0.24} />
                <stop offset="100%" stopColor={vizSeriesColor(colorIndex)} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <YAxis hide domain={[0, domainMax]} />
            <Tooltip
              content={<VizTooltip unit="条" />}
              cursor={{ stroke: VIZ.axisText, strokeWidth: 1, strokeOpacity: 0.4 }}
            />
            <Area
              type="monotone"
              dataKey="value"
              name={title}
              stroke={vizSeriesColor(colorIndex)}
              strokeWidth={1.5}
              fill={`url(#iris-mini-${colorIndex})`}
              dot={false}
              activeDot={{ r: 3, fill: vizSeriesColor(colorIndex), stroke: VIZ.surface, strokeWidth: 1.5 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <span className="admin-viz__mini-foot num">
        峰值 {formatVizNumber(peak ?? NaN)}
        {average !== null ? ` · 日均 ${formatVizNumber(Number(average.toFixed(2)))}` : ""}
      </span>
    </div>
  )
}
