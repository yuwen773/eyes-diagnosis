import { useEffect, useMemo, useRef, useState, type ReactElement } from "react"
import { Link } from "react-router-dom"

import { SectionHead } from "@/components/SectionHead"
import { StatTile } from "@/components/admin/StatTile"
import { Toolbar } from "@/components/admin/Toolbar"
import { SmallMultipleTrend } from "@/components/admin/charts/SmallMultipleTrend"
import { WeekBars } from "@/components/admin/charts/WeekBars"
import { ShareBar } from "@/components/admin/charts/ShareBar"
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
import { changeLabel, sharedDomainMax, weekdayBreakdown } from "@/lib/chartData"
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

/** 待人工复核在状态分布里的名字（用于给占比条上强调色）。 */
const AWAITING_REVIEW_LABEL = humanReviewStatusLabel("AWAITING_REVIEW")

type View = { data: AdminStats | null; fault: ErrorDetail | null }

/**
 * 数据分析（真实统计）。
 *
 * 与仪表盘同一份口径（同一个后端端点），只是把窗口拉长、维度拆细：
 * 时间范围切换真的会重新取数，不是装饰。
 *
 * 两条口径上的硬规矩：
 * <ul>
 *   <li>病种小倍数共用同一个 Y 上限——各画各的归一化会让「日增 2 条」和
 *       「日增 200 条」看起来一样高；</li>
 *   <li>按星期分布的主读数是窗口内合计与日均，不是周日那一格的值。</li>
 * </ul>
 */
export function AdminDataAnalysisPage(): ReactElement {
  const [days, setDays] = useState<number>(30)
  const [view, setView] = useState<View>({ data: null, fault: null })
  const requestSeq = useRef(0)

  useEffect(() => {
    const seq = ++requestSeq.current
    getAdminStats(days).then(
      (data) => {
        if (seq !== requestSeq.current) return
        setView({ data, fault: null })
      },
      (cause) => {
        if (seq !== requestSeq.current) return
        setView({ data: null, fault: describeError(cause) })
      },
    )
  }, [days])

  const stats = view.data
  const statsLoading = view.data === null && view.fault === null

  /**
   * 病种日趋势：后端给的是「一天 + 病种 + 计数」的扁平行，这里按病种折成
   * 一条条与 trendDays 对齐的序列（缺的那天补 0——不补会把「周三没数据」
   * 画成和周二一样多）。
   */
  const diseaseSeries = useMemo(() => {
    const trendDays = stats?.trendDays ?? []
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
  }, [stats])

  /** 小倍数的统一 Y 上限：所有病种共用，跨病种才可比。 */
  const domainMax = useMemo(
    () => sharedDomainMax(diseaseSeries.map((series) => series.points)),
    [diseaseSeries],
  )

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

  /** 新增用户的按周分布：合计与日均才是主读数。 */
  const weekly = useMemo(
    () => weekdayBreakdown(stats?.userTrend ?? [], stats?.days ?? days),
    [stats, days],
  )

  const awaitingTotal = stats?.diagnosisAwaitingReviewTotal ?? 0
  const aiRejected = stats?.diagnosisAiRejected ?? 0
  const inRange = stats?.diagnosisInRange ?? 0
  const rejectShare = inRange > 0 ? aiRejected / inRange : 0

  /** 读数：统计还没回来时给破折号，不给 0。 */
  const read = (value: number | undefined): string =>
    stats ? formatStatNumber(value ?? 0) : "—"

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
          value={read(stats?.diagnosisInRange)}
          delta={
            stats
              ? changeLabel(stats.diagnosisInRange, stats.previousDiagnosisInRange)
              : undefined
          }
          accent
        />
        <StatTile
          label="待人工复核"
          value={read(stats?.diagnosisAwaitingReviewTotal)}
          tone={awaitingTotal > 0 ? "attention" : "normal"}
          toneLabel={awaitingTotal > 0 ? "待处理" : "已清空"}
          action={{ label: "去复核", to: "/admin/diagnosis?review=requiresReview" }}
        />
        <StatTile
          label="AI 拒识"
          value={read(stats?.diagnosisAiRejected)}
          tone={aiRejected > 0 ? "attention" : "normal"}
          toneLabel={aiRejected > 0 ? "无结论" : "无"}
          delta={`占窗口内判读 ${formatStatPercent(rejectShare)}`}
        />
        <StatTile
          label="窗口内新增用户"
          value={read(stats?.userNew)}
          delta={stats ? changeLabel(stats.userNew, stats.previousUserNew) : undefined}
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
        <h2 className="admin-analysis__title">
          病种趋势
          <span className="admin-analysis__title-note num">
            统一纵轴上限 {formatStatNumber(domainMax)} 条 · 跨病种可比
          </span>
        </h2>
        {statsLoading ? (
          <p className="admin-analysis__empty num">统计载入中…</p>
        ) : diseaseSeries.length === 0 ? (
          <p className="admin-analysis__empty num">窗口内没有可统计的判读记录。</p>
        ) : (
          <div className="admin-analysis__grid admin-analysis__grid--trend">
            {diseaseSeries.map((series) => (
              <SmallMultipleTrend
                key={series.name}
                title={series.name}
                points={series.points}
                domainMax={domainMax}
              />
            ))}
          </div>
        )}
      </section>

      <section className="admin-analysis__section" aria-label="病种分布与复核状态">
        <div className="admin-analysis__grid admin-analysis__grid--pair">
          <RankedBars rows={distribution} ariaLabel="病种分布" unit="条" />
          <ShareBar
            rows={reviewDistribution}
            ariaLabel="复核状态分布"
            accentNames={[AWAITING_REVIEW_LABEL]}
          />
        </div>
      </section>

      <section className="admin-analysis__section" aria-label="按星期分布">
        <h2 className="admin-analysis__title">新增用户 · 按星期分布</h2>
        <WeekBars
          bars={weekly.bars}
          title="新增注册 · 按星期"
          ariaLabel="新增用户按星期分布"
          total={weekly.total}
          average={weekly.average}
          windowDays={stats?.days ?? days}
        />
      </section>

      <section className="admin-analysis__section" aria-label="知识库与资讯">
        <div className="admin-analysis__grid admin-analysis__grid--pair">
          <RankedBars rows={knowledgeDistribution} ariaLabel="知识库文档状态分布" unit="份" />
          <RankedBars rows={newsDistribution} ariaLabel="资讯发布状态分布" unit="篇" />
        </div>
        {stats && stats.knowledgeFailed > 0 ? (
          <p className="admin-analysis__note num">
            知识库有 {formatStatNumber(stats.knowledgeFailed)} 份文档处理失败 ·
            <Link className="admin-analysis__note-link" to="/admin/knowledge?status=2">
              去处理
            </Link>
          </p>
        ) : null}
      </section>

      {stats ? (
        <p className="admin-analysis__note num">
          平均置信度 {formatStatPercent(stats.avgConfidence)}（模型自评的置信度均值，
          <b>不是诊断准确率</b>） · 已复核 {formatStatNumber(stats.diagnosisReviewed)} 条 ·
          知识库文档 {formatStatNumber(stats.knowledgeTotal)} 份 / 切片{" "}
          {formatStatNumber(stats.knowledgeChunks)} 块
        </p>
      ) : null}
    </div>
  )
}
