import type { ReactElement } from "react"
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts"

import { VIZ, VizTooltip, formatVizNumber } from "./ChartFrame"

/**
 * 统一尺度的小倍数折线。
 *
 * <p>关键约束：所有小倍数共用同一个 Y 上限（domainMax）。各病种各画各的
 * 归一化折线时，日增 2 条的病种和日增 200 条的病种看起来一样高——那是假的。
 * 共用尺度之后，「哪个病种在涨」才是能直接比出来的。
 *
 * <p>小倍数本身信息密度低，所以读数照旧常驻：标题 + 末值 + 图/表切换之外，
 * 这里给每格一个 aria-label，键盘读到格就播报末值与峰值。
 */
export function SmallMultipleTrend(props: {
  title: string
  points: number[]
  /** 与其它小倍数共用的 Y 上限 */
  domainMax: number
  labels?: string[]
}): ReactElement {
  const { title, points, domainMax, labels } = props
  const last = points.length > 0 ? points[points.length - 1] : undefined
  const peak = points.length > 0 ? Math.max(...points) : undefined
  const data = points.map((value, index) => ({
    label: labels?.[index] ?? String(index + 1),
    value,
  }))

  const readout = `末值 ${formatVizNumber(last ?? NaN)}，峰值 ${formatVizNumber(
    peak ?? NaN,
  )}`

  return (
    <div className="admin-viz__mini" tabIndex={0} role="group" aria-label={`${title}，${readout}`}>
      <span className="admin-viz__mini-title">{title}</span>
      <div className="admin-viz__mini-svg">
        <ResponsiveContainer width="100%" height={72}>
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
            <YAxis hide domain={[0, domainMax]} />
            <Tooltip
              content={<VizTooltip unit="条" />}
              cursor={{ stroke: VIZ.axisText, strokeWidth: 1, strokeOpacity: 0.4 }}
            />
            <Line
              type="monotone"
              dataKey="value"
              name={title}
              stroke={VIZ.mute}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3, fill: VIZ.accent }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <span className="admin-viz__mini-value num">{formatVizNumber(last ?? NaN)}</span>
    </div>
  )
}
