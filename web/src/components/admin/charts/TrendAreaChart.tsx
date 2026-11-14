import { useId, type ReactElement } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import {
  ChartView,
  VIZ,
  VIZ_AXIS_TICK,
  VizTooltip,
  formatVizNumber,
} from "./ChartFrame"

/**
 * 判读趋势（面积 + 上一等长窗口对比）。
 *
 * <p>两个系列：
 * <ul>
 *   <li><b>本期</b>：信号橙面积（10% 淡填 + 2px 实线），端点直标最后一天的读数；</li>
 *   <li><b>上一等长窗口</b>：去强调墨色细线，无填充——它是参照，不是主角。</li>
 * </ul>
 *
 * <p>面积而不是纯折线：判读量是「规模」，面积比折线更能读出体量。
 * 网格与轴一律 1px 实线发丝（--hr），无双线、无虚线。
 */
export function TrendAreaChart(props: {
  data: { day: string; label: string; value: number; previous: number }[]
  ariaLabel: string
  height?: number
  /** 对照系列的图例名 */
  previousLabel?: string
}): ReactElement {
  const { data, ariaLabel, height = 280, previousLabel = "上一等长窗口" } = props
  const gradientId = `iris-viz-area-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`

  // 卡片右上角的口径读数：窗口的规模，而不是最后一天的读数。
  // 「最新 N」看着精确，实际是被窗口末尾那一天的噪声左右的数——窗口最后一天
  // 常常没有判读，它读出来是 0，读者会以为这批记录清零了。合计 + 日均说的是
  // 整条曲线代表的量，与纵轴、与 KPI 读数轨同口径。
  const sum = data.reduce((total, row) => total + row.value, 0)
  const average = data.length > 0 ? sum / data.length : 0
  const headExtra =
    data.length > 0
      ? `合计 ${formatVizNumber(sum)} · 日均 ${formatVizNumber(Number(average.toFixed(1)))}`
      : undefined

  return (
    <ChartView
      title={ariaLabel}
      ariaLabel={ariaLabel}
      labelHeader="日期"
      headExtra={headExtra}
      rows={data.map((row) => ({
        label: row.label,
        value: formatVizNumber(row.value),
        extra: formatVizNumber(row.previous),
      }))}
      extraHeader={previousLabel}
      figure={
        <div className="admin-viz__chart">
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data} margin={{ top: 10, right: 52, bottom: 4, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={VIZ.accent} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={VIZ.accent} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={VIZ.rule} vertical={false} />
              <XAxis
                dataKey="label"
                tick={VIZ_AXIS_TICK}
                axisLine={{ stroke: VIZ.rule }}
                tickLine={false}
                minTickGap={26}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={VIZ_AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={40}
                allowDecimals={false}
              />
              <Tooltip
                content={
                  <VizTooltip unit="条" />
                }
                cursor={{ stroke: VIZ.axisText, strokeWidth: 1, strokeOpacity: 0.5 }}
              />
              <Area
                type="monotone"
                dataKey="value"
                name="本期"
                stroke={VIZ.accent}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 4, fill: VIZ.accent, stroke: VIZ.surface, strokeWidth: 2 }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="previous"
                name={previousLabel}
                stroke={VIZ.mute}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: VIZ.mute }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
          <p className="admin-viz__legend">
            <span className="admin-viz__legend-item">
              <span className="admin-viz__swatch admin-viz__swatch--accent" />
              本期
            </span>
            <span className="admin-viz__legend-item">
              <span className="admin-viz__swatch admin-viz__swatch--mute" />
              {previousLabel}
            </span>
          </p>
        </div>
      }
    />
  )
}
