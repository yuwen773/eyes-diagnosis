import { useMemo, useState, type ReactElement } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"

import { SectionHead } from "@/components/SectionHead"
import { StatTile } from "@/components/admin/StatTile"
import { TrendAreaChart } from "@/components/admin/charts/TrendAreaChart"
import { ShareBar } from "@/components/admin/charts/ShareBar"
import { RankedBars } from "@/components/admin/charts/RankedBars"
import { DataTable, type Column } from "@/components/admin/DataTable"
import { FaultNote } from "@/components/fault"
import { getAdminStats, listDiagnoses, type AdminDiagnosis } from "@/lib/adminApi"
import {
  confidencePercent,
  formatStatNumber,
  formatStatPercent,
  humanReviewStatusLabel,
  rankDistribution,
} from "@/lib/adminDomain"
import { alignPreviousWindow, changeLabel } from "@/lib/chartData"
import { describeError } from "@/lib/api"
import { queryKeys } from "@/lib/queryKeys"
import { formatTimestamp } from "@/lib/domain"
import { fault } from "@/lib/faults"

/** 统计时间窗：整页统一，KPI、趋势、分布都覆盖同一段时间。 */
const RANGES = [
  { value: 7, label: "7 天" },
  { value: 30, label: "30 天" },
  { value: 90, label: "90 天" },
]

/** 待人工复核在状态分布里的名字（用于给占比条上强调色）。 */
const AWAITING_REVIEW_LABEL = humanReviewStatusLabel("AWAITING_REVIEW")

/**
 * 仪表盘（真实统计 · 运营工作台）。
 *
 * <p>读数来自 {@code GET /stats/admin/overview}：KPI、趋势、分布都是后端聚合
 * 出来的真实数据，不再是示例数据。
 *
 * <p>排序原则：先说「现在有什么要处理」，再说「系统产出了多少数据」。
 * 待复核积压、AI 拒识、失败任务是动作项，排在最前面并直接给出下钻入口；
 * 判读量与新增用户是背景读数。平均置信度只作为附注出现，并注明它不是准确率。
 *
 * <p>两组请求各自独立：统计与最近记录分别取、分别落地。加载态由「还没有数据
 * 也没有错误」派生，不在 effect 里同步写 state。
 */
export function AdminDashboardPage(): ReactElement {
  const [days, setDays] = useState(30)

  const statsQuery = useQuery({
    queryKey: queryKeys.admin.stats(days),
    queryFn: () => getAdminStats(days),
    // 切窗必须立刻失效：不同窗口是不同的查询键；gcTime 0 让离开的窗口马上被回收。
    gcTime: 0,
    staleTime: 0,
  })
  const recentQuery = useQuery({
    queryKey: queryKeys.admin.recentDiagnoses,
    queryFn: () => listDiagnoses({ current: 1, pageSize: 5 }),
  })

  // 第二道守卫：后端回显的窗口天数与选中值不一致时，当作还没读到。
  const stats = statsQuery.data?.days === days ? statsQuery.data : undefined
  const statsFault = statsQuery.error ? describeError(statsQuery.error) : null
  const statsLoading = !stats && !statsFault

  const changeDays = (next: number) => {
    if (next !== days) setDays(next)
  }

  const recent = recentQuery.data
  const recentFault = recentQuery.error ? describeError(recentQuery.error) : null
  const recentLoading = recentQuery.isPending

  const trendRows = useMemo(
    () =>
      alignPreviousWindow(
        stats?.trendDays ?? [],
        stats?.diagnosisTrend ?? [],
        stats?.previousDiagnosisTrend ?? [],
      ),
    [stats],
  )

  const distribution = rankDistribution(stats?.diagnosisDistribution ?? [])

  const reviewDistribution = useMemo(
    () =>
      rankDistribution(
        (stats?.reviewDistribution ?? []).map((row) => ({
          name: humanReviewStatusLabel(row.name),
          value: row.value,
        })),
      ),
    [stats],
  )

  const newsPending = useMemo(() => {
    const row = (stats?.newsByStatus ?? []).find((entry) => Number(entry.name) === 3)
    return row ? row.value : 0
  }, [stats])

  const awaitingTotal = stats?.diagnosisAwaitingReviewTotal ?? 0
  const aiRejected = stats?.diagnosisAiRejected ?? 0
  const inRange = stats?.diagnosisInRange ?? 0
  const rejectShare = inRange > 0 ? aiRejected / inRange : 0

  /** 读数：统计还没回来时给破折号，不给 0——「还没读到」和「读到是零」是两件事。 */
  const read = (value: number | undefined): string =>
    stats ? formatStatNumber(value ?? 0) : "—"

  const recentRows = recent?.records ?? []

  const recentColumns: Column<AdminDiagnosis>[] = [
    { key: "username", title: "用户", width: "140px" },
    {
      key: "result",
      title: "结果",
      render: (row) => row.result ?? (row.aiRejected ? "AI 拒识" : "—"),
    },
    {
      key: "confidence",
      title: "置信度",
      width: "96px",
      mono: true,
      render: (row) => confidencePercent(row.confidence),
    },
    {
      key: "createTime",
      title: "时间",
      width: "180px",
      mono: true,
      render: (row) => formatTimestamp(row.createTime),
    },
  ]

  return (
    <div className="admin-dashboard">
      <div className="admin-dashboard__head">
        <SectionHead code="01" kicker="仪表盘" en="ADMIN · DASHBOARD" />
        <div className="admin-dashboard__range" role="group" aria-label="统计时间窗">
          {RANGES.map((range) => (
            <button
              key={range.value}
              type="button"
              className="admin-dashboard__range-btn"
              aria-pressed={days === range.value}
              onClick={() => changeDays(range.value)}
            >
              {range.label}
            </button>
          ))}
        </div>
        {stats ? (
          <span className="admin-sample num">
            {stats.rangeStart} ~ {stats.rangeEnd} · 近 {stats.days} 天
          </span>
        ) : null}
      </div>

      {statsFault ? (
        <FaultNote
          className="admin-dashboard__fault"
          fault={fault({
            severity: "attention",
            kind: "client",
            title: statsFault.text,
            code: statsFault.code,
          })}
        />
      ) : null}

      {/* KPI：动作项在前（待复核 / 拒识），背景读数在后（判读量 / 新增用户）。 */}
      <section className="admin-kpis" aria-label="关键指标">
        <StatTile
          label="待人工复核"
          value={read(stats?.diagnosisAwaitingReviewTotal)}
          tone={awaitingTotal > 0 ? "attention" : "normal"}
          toneLabel={awaitingTotal > 0 ? "待处理" : "已清空"}
          delta={
            stats ? `窗口内新增 ${formatStatNumber(stats.diagnosisAwaitingReview)} 条` : undefined
          }
          action={{ label: "去复核", to: "/admin/diagnosis?review=requiresReview" }}
          accent
        />
        <StatTile
          label="AI 拒识"
          value={read(stats?.diagnosisAiRejected)}
          tone={aiRejected > 0 ? "attention" : "normal"}
          toneLabel={aiRejected > 0 ? "无结论" : "无"}
          delta={`占窗口内判读 ${formatStatPercent(rejectShare)}`}
          action={{ label: "去查看", to: "/admin/diagnosis?review=aiRejected" }}
        />
        <StatTile
          label="窗口内判读"
          value={read(stats?.diagnosisInRange)}
          delta={
            stats
              ? changeLabel(stats.diagnosisInRange, stats.previousDiagnosisInRange)
              : undefined
          }
        />
        <StatTile
          label="窗口内新增用户"
          value={read(stats?.userNew)}
          delta={
            stats ? changeLabel(stats.userNew, stats.previousUserNew) : undefined
          }
        />
      </section>

      {/* 待处理事项：每条直接给出「去哪儿处理」，不再让管理员自己找列表。 */}
      <section className="admin-dashboard__actions" aria-label="待处理事项">
        <h2 className="admin-dashboard__actions-title">待处理事项</h2>
        <ul className="admin-dashboard__action-list">
          <li className="admin-dashboard__action">
            <span className="admin-dashboard__action-label">待人工复核</span>
            <span className="admin-dashboard__action-value num">
              {read(stats?.diagnosisAwaitingReviewTotal)}
            </span>
            <Link className="admin-dashboard__action-link" to="/admin/diagnosis?review=requiresReview">
              去复核
            </Link>
          </li>
          <li className="admin-dashboard__action">
            <span className="admin-dashboard__action-label">AI 拒识记录</span>
            <span className="admin-dashboard__action-value num">
              {read(stats?.diagnosisAiRejected)}
            </span>
            <Link className="admin-dashboard__action-link" to="/admin/diagnosis?review=aiRejected">
              去查看
            </Link>
          </li>
          <li className="admin-dashboard__action">
            <span className="admin-dashboard__action-label">知识库处理失败</span>
            <span className="admin-dashboard__action-value num">
              {read(stats?.knowledgeFailed)}
            </span>
            <Link className="admin-dashboard__action-link" to="/admin/knowledge?status=2">
              去处理
            </Link>
          </li>
          <li className="admin-dashboard__action">
            <span className="admin-dashboard__action-label">资讯待审核</span>
            <span className="admin-dashboard__action-value num">
              {read(newsPending)}
            </span>
            <Link className="admin-dashboard__action-link" to="/admin/news?status=3">
              去审核
            </Link>
          </li>
        </ul>
      </section>

      <section className="admin-dashboard__charts" aria-label="趋势与分布">
        {statsLoading ? (
          <p className="admin-dashboard__loading num">统计载入中…</p>
        ) : (
          <TrendAreaChart
            data={trendRows}
            ariaLabel={`判读趋势 · 近 ${days} 天（含上一等长窗口对照）`}
          />
        )}
      </section>

      <section className="admin-dashboard__split" aria-label="复核状态与病种分布">
        {statsLoading ? null : (
          <>
            <ShareBar
              rows={reviewDistribution}
              ariaLabel="复核状态分布"
              accentNames={[AWAITING_REVIEW_LABEL]}
            />
            <RankedBars rows={distribution} ariaLabel="病种分布" unit="条" />
          </>
        )}
      </section>

      <section className="admin-dashboard__records" aria-label="最近判读记录">
        <h2 className="admin-dashboard__records-title">
          最近判读记录
          <span className="admin-analysis__title-note num">最新 5 条 · 全量在诊断管理</span>
        </h2>
        {recentFault ? (
          <FaultNote
            className="admin-dashboard__fault"
            fault={fault({
              severity: "attention",
              kind: "client",
              title: `最近判读记录加载失败：${recentFault.text}`,
              code: recentFault.code,
            })}
          />
        ) : null}
        <DataTable<AdminDiagnosis>
          columns={recentColumns}
          rows={recentRows}
          rowKey={(row) => row.id}
          loading={recentLoading}
          emptyText="暂无判读记录"
          page={{ current: 1, pageSize: 5, total: recent?.total ?? 0 }}
          onPageChange={() => {}}
          hidePager
        />
      </section>

      {stats ? (
        <p className="admin-dashboard__note num">
          平均置信度 {formatStatPercent(stats.avgConfidence)}（模型自评的置信度均值，
          <b>不是诊断准确率</b>） · 已复核 {formatStatNumber(stats.diagnosisReviewed)} 条 ·
          AI 拒识 {formatStatNumber(stats.diagnosisAiRejected)} 条 · 资讯{" "}
          {formatStatNumber(stats.newsTotal)} 篇
        </p>
      ) : null}
    </div>
  )
}

export default AdminDashboardPage
