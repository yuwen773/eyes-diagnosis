import { useCallback, useEffect, useRef, useState, type ReactElement } from "react"

import { SectionHead } from "@/components/SectionHead"
import { StatTile } from "@/components/admin/StatTile"
import { Toolbar } from "@/components/admin/Toolbar"
import { MiniTrend } from "@/components/admin/charts/MiniTrend"
import { MiniBars } from "@/components/admin/charts/MiniBars"
import { RankedBars } from "@/components/admin/charts/RankedBars"
import { FaultNote } from "@/components/fault"
import { getAdminStats, type AdminStats } from "@/lib/adminApi"
import {
  formatStatNumber,
  formatStatPercent,
  humanReviewStatusLabel,
  knowledgeStatusView,
  newsStatusView,
  rankDistribution,
} from "@/lib/adminDomain"
import { describeError, type ErrorDetail } from "@/lib/api"
import { fault } from "@/lib/faults"

/** 时间窗选项（天）。 */
const RANGES = [
  { value: "7", label: "近 7 天" },
  { value: "30", label: "近 30 天" },
  { value: "90", label: "近 90 天" },
] as const

/** 小倍数折线最多画几条病种：再多就成了一团面条，身份读不出来。 */
const MAX_DISEASE_SERIES = 6

type View = { data: AdminStats | null; fault: ErrorDetail | null; loading: boolean }

/**
 * 数据分析（真实统计）。
 *
 * 与仪表盘同一份口径（同一个后端端点），只是把窗口拉长、维度拆细：
 * 时间范围切换真的会重新取数，不是装饰。
 *
 * 版式沿用仪表盘：章节头 → KPI 条 → 工具条（时间范围）→ 病种小倍数折线 →
 * 分布排序横条。所有数字都是后端聚合出的真实读数。
 */
export function AdminDataAnalysisPage(): ReactElement {
  const [days, setDays] = useState<number>(30)
  const [view, setView] = useState<View>({ data: null, fault: null, loading: true })
  const requestSeq = useRef(0)

  const load = useCallback((windowDays: number) => {
    const seq = ++requestSeq.current
    setView((prev) => ({ data: prev.data, fault: null, loading: true }))
    getAdminStats(windowDays).then(
      (data) => {
        if (seq !== requestSeq.current) return
        setView({ data, fault: null, loading: false })
      },
      (cause) => {
        if (seq !== requestSeq.current) return
        setView({ data: null, fault: describeError(cause), loading: false })
      },
    )
  }, [])

  useEffect(() => {
    load(days)
  }, [load, days])

  const stats = view.data
  const trendDays = stats?.trendDays ?? []

  /**
   * 病种日趋势：后端给的是「一天 + 病种 + 计数」的扁平行，这里按病种折成
   * 一条条与 trendDays 对齐的序列（缺的那天补 0——不补会把「周三没数据」
   * 画成和周二一样多）。
   */
  const diseaseSeries = (() => {
    const rows = stats?.diagnosisTrendByResult ?? []
    const totals = new Map<string, number>()
    const byName = new Map<string, Map<string, number>>()
    for (const row of rows) {
      totals.set(row.name, (totals.get(row.name) ?? 0) + row.value)
      const series = byName.get(row.name) ?? new Map<string, number>()
      series.set(row.day, row.value)
      byName.set(row.name, series)
    }
    const names = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_DISEASE_SERIES)
      .map(([name]) => name)
    return names.map((name) => ({
      name,
      points: trendDays.map((day) => byName.get(name)?.get(day) ?? 0),
    }))
  })()

  const distribution = rankDistribution(stats?.diagnosisDistribution ?? [])

  /** 复核状态分布：后端给的是状态代码，这里换成中文标签再排序。 */
  const reviewDistribution = rankDistribution(
    (stats?.reviewDistribution ?? []).map((row) => ({
      name: humanReviewStatusLabel(row.name),
      value: row.value,
    })),
  )

  /** 知识库状态分布（0 处理中 / 1 已完成 / 2 失败）。 */
  const knowledgeDistribution = rankDistribution(
    (stats?.knowledgeByStatus ?? []).map((row) => ({
      name: knowledgeStatusView(Number(row.name)).label,
      value: row.value,
    })),
  )

  /** 资讯发布状态分布（0 草稿 / 1 已发布 / 2 下架 / 3 待审核）。 */
  const newsDistribution = rankDistribution(
    (stats?.newsByStatus ?? []).map((row) => ({
      name: newsStatusView(Number(row.name)).label,
      value: row.value,
    })),
  )

  /** 新增用户的按周分布（周一 ~ 周日，按窗口内的日期归到星期）。 */
  const userWeekBars = (() => {
    const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    const totals = new Array(7).fill(0) as number[]
    for (const row of stats?.userTrend ?? []) {
      const date = new Date(`${row.day}T00:00:00`)
      if (Number.isNaN(date.getTime())) continue
      // getDay(): 0=周日 → 转成 1=周一 … 7=周日
      const index = (date.getDay() + 6) % 7
      totals[index] += row.value
    }
    return labels.map((label, i) => ({ label, value: totals[i] }))
  })()

  return (
    <div className="admin-analysis">
      <div className="admin-analysis__head">
        <SectionHead code="06" kicker="数据分析" en="ADMIN · DATA ANALYSIS" />
        {stats ? (
          <span className="admin-sample num">
            {stats.rangeStart} ~ {stats.rangeEnd} · 近 {stats.days} 天
          </span>
        ) : null}
      </div>

      {view.fault ? (
        <FaultNote
          className="admin-analysis__fault"
          fault={fault({
            severity: "attention",
            kind: "client",
            title: view.fault.text,
            code: view.fault.code,
          })}
        />
      ) : null}

      <section className="admin-kpis" aria-label="关键指标">
        <StatTile
          label="窗口内判读"
          value={stats ? formatStatNumber(stats.diagnosisInRange) : "—"}
          delta={stats ? `累计 ${formatStatNumber(stats.diagnosisTotal)} 条` : undefined}
          accent
        />
        <StatTile
          label="窗口内新增用户"
          value={stats ? formatStatNumber(stats.userNew) : "—"}
          delta={stats ? `用户总数 ${formatStatNumber(stats.userTotal)}` : undefined}
        />
        <StatTile
          label="平均置信度"
          value={stats ? formatStatPercent(stats.avgConfidence) : "—"}
          delta={stats ? `待复核 ${formatStatNumber(stats.diagnosisAwaitingReview)} 条` : undefined}
        />
        <StatTile
          label="AI 拒识"
          value={stats ? formatStatNumber(stats.diagnosisAiRejected) : "—"}
          delta={stats ? `已复核 ${formatStatNumber(stats.diagnosisReviewed)} 条` : undefined}
        />
      </section>

      <Toolbar>
        <label className="admin-analysis__field">
          <span className="admin-analysis__label">时间范围 · RANGE</span>
          <select
            className="admin-analysis__select"
            value={String(days)}
            onChange={(event) => setDays(Number(event.target.value))}
            aria-label="时间范围"
          >
            {RANGES.map((range) => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </select>
        </label>
      </Toolbar>

      <section className="admin-analysis__section" aria-label="病种趋势">
        <h2 className="admin-analysis__title">病种趋势</h2>
        {diseaseSeries.length === 0 ? (
          <p className="admin-analysis__empty num">窗口内没有可统计的判读记录。</p>
        ) : (
          <div className="admin-analysis__grid admin-analysis__grid--trend">
            {diseaseSeries.map((series) => (
              <MiniTrend key={series.name} title={series.name} points={series.points} />
            ))}
          </div>
        )}
      </section>

      <section className="admin-analysis__section" aria-label="病种分布">
        <h2 className="admin-analysis__title">病种分布</h2>
        <RankedBars rows={distribution} ariaLabel="病种分布" />
      </section>

      <section className="admin-analysis__section" aria-label="复核状态分布">
        <h2 className="admin-analysis__title">复核状态分布</h2>
        <RankedBars rows={reviewDistribution} ariaLabel="复核状态分布" />
      </section>

      <section className="admin-analysis__section" aria-label="按周活跃">
        <h2 className="admin-analysis__title">新增用户 · 按星期分布</h2>
        <div className="admin-analysis__grid admin-analysis__grid--weekly">
          <MiniBars title="新增注册" bars={userWeekBars} />
        </div>
      </section>

      <section className="admin-analysis__section" aria-label="知识库与资讯">
        <div className="admin-analysis__grid admin-analysis__grid--weekly">
          <RankedBars rows={knowledgeDistribution} ariaLabel="知识库文档状态分布" />
          <RankedBars rows={newsDistribution} ariaLabel="资讯发布状态分布" />
        </div>
      </section>
    </div>
  )
}

export default AdminDataAnalysisPage
