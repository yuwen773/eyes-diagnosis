import { useEffect, useMemo, useRef, useState, type ReactElement } from "react"
import { Link } from "react-router-dom"

import { SectionHead } from "@/components/SectionHead"
import { StatTile } from "@/components/admin/StatTile"
import { TrendAreaChart } from "@/components/admin/charts/TrendAreaChart"
import { ShareBar } from "@/components/admin/charts/ShareBar"
import { RankedBars } from "@/components/admin/charts/RankedBars"
import { DataTable, type Column } from "@/components/admin/DataTable"
import { FaultNote } from "@/components/fault"
import {
  getAdminStats,
  listDiagnoses,
  type AdminDiagnosis,
  type AdminStats,
  type Page,
} from "@/lib/adminApi"
import {
  confidencePercent,
  formatStatNumber,
  formatStatPercent,
  humanReviewStatusLabel,
  rankDistribution,
} from "@/lib/adminDomain"
import { alignPreviousWindow, changeLabel } from "@/lib/chartData"
import { describeError, type ErrorDetail } from "@/lib/api"
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

type View = { data: AdminStats | null; fault: ErrorDetail | null }
/** 最近记录单独一套三态：统计先回、记录还在飞，不该被说成「暂无记录」。 */
type RecentView = {
  data: Page<AdminDiagnosis> | null
  fault: ErrorDetail | null
}

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
  const [view, setView] = useState<View>({ data: null, fault: null })
  const [recent, setRecent] = useState<RecentView>({ data: null, fault: null })
  const requestSeq = useRef(0)
  const recentSeq = useRef(0)

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

  useEffect(() => {
    const seq = ++recentSeq.current
    listDiagnoses({ current: 1, pageSize: 5 }).then(
      (data) => {
        if (seq !== recentSeq.current) return
        setRecent({ data, fault: null })
      },
      (cause) => {
        if (seq !== recentSeq.current) return
        setRecent({ data: null, fault: describeError(cause) })
      },
    )
  }, [])

  const stats = view.data
  const statsLoading = view.data === null && view.fault === null

  /**
   * 切窗先让旧数据失效，再发新请求：否则请求在途时会出现
   * 「按钮说 90 天、图里还是 30 天」的读数。
   */
  const changeDays = (next: number) => {
    if (next === days) return
    setView({ data: null, fault: null })
    setDays(next)
  }
  const recentLoading = recent.data === null && recent.fault === null

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

  const recentRows = recent.data?.records ?? []

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

      {view.fault ? (
        <FaultNote
          className="admin-dashboard__fault"
          fault={fault({
            severity: "attention",
            kind: "client",
            title: view.fault.text,
            code: view.fault.code,
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
        <h2 className="admin-dashboard__records-title">最近判读记录</h2>
        {recent.fault ? (
          <FaultNote
            className="admin-dashboard__fault"
            fault={fault({
              severity: "attention",
              kind: "client",
              title: `最近判读记录加载失败：${recent.fault.text}`,
              code: recent.fault.code,
            })}
          />
        ) : null}
        <DataTable<AdminDiagnosis>
          columns={recentColumns}
          rows={recentRows}
          rowKey={(row) => row.id}
          loading={recentLoading}
          emptyText="暂无判读记录"
          page={{ current: 1, pageSize: 5, total: recent.data?.total ?? 0 }}
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
