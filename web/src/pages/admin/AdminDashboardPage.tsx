import { useCallback, useEffect, useRef, useState, type ReactElement } from "react"

import { SectionHead } from "@/components/SectionHead"
import { StatTile } from "@/components/admin/StatTile"
import { TrendChart } from "@/components/admin/charts/TrendChart"
import { RankedBars } from "@/components/admin/charts/RankedBars"
import { DataTable } from "@/components/admin/DataTable"
import type { Column } from "@/components/admin/DataTable"
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
  rankDistribution,
} from "@/lib/adminDomain"
import { describeError, type ErrorDetail } from "@/lib/api"
import { formatTimestamp } from "@/lib/domain"
import { fault } from "@/lib/faults"

/** 仪表盘读数的时间窗：近 30 天。 */
const RANGE_DAYS = 30
/** 趋势图取最近 7 天（30 天的折线挤在一张图里读不出日节律）。 */
const TREND_DAYS = 7

type View = { data: AdminStats | null; fault: ErrorDetail | null; loading: boolean }

/** 日期 → 轴标签：只留月-日，轴上要的是「哪天」不是「哪年」。 */
function dayLabel(day: string): string {
  return day.length >= 10 ? day.slice(5) : day
}

/**
 * 仪表盘（真实统计）。
 *
 * 数据来自 {@code GET /stats/admin/overview}：KPI 条、趋势、病种分布都是后端
 * 聚合出来的真实读数，不再是示例数据。页面上仍然标注统计口径（时间窗），
 * 让读数的人知道这些数字覆盖的是哪一段时间。
 */
export function AdminDashboardPage(): ReactElement {
  const [view, setView] = useState<View>({ data: null, fault: null, loading: true })
  const requestSeq = useRef(0)

  const [recent, setRecent] = useState<Page<AdminDiagnosis> | null>(null)

  /** 取一次总览 + 一次最近判读记录。两次请求互不依赖，各自落地。 */
  const load = useCallback(() => {
    const seq = ++requestSeq.current
    setView((prev) => ({ data: prev.data, fault: null, loading: true }))
    getAdminStats(RANGE_DAYS).then(
      (data) => {
        if (seq !== requestSeq.current) return
        setView({ data, fault: null, loading: false })
      },
      (cause) => {
        if (seq !== requestSeq.current) return
        setView({ data: null, fault: describeError(cause), loading: false })
      },
    )
    listDiagnoses({ current: 1, pageSize: 5 }).then(
      (data) => setRecent(data),
      () => setRecent(null),
    )
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const stats = view.data
  const trendPoints = (stats?.diagnosisTrend ?? [])
    .slice(-TREND_DAYS)
    .map((row) => ({ label: dayLabel(row.day), value: row.value }))
  const distribution = rankDistribution(stats?.diagnosisDistribution ?? [])

  const recentRows = recent?.records ?? []

  const recentColumns: Column<AdminDiagnosis>[] = [
    { key: "username", title: "用户", width: "140px" },
    {
      key: "result",
      title: "结果",
      render: (row) =>
        row.result ?? (row.aiRejected ? "AI 拒识" : "—"),
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

      <section className="admin-kpis" aria-label="关键指标">
        <StatTile
          label="判读总数"
          value={stats ? formatStatNumber(stats.diagnosisTotal) : "—"}
          delta={stats ? `窗口内 ${formatStatNumber(stats.diagnosisInRange)} 条` : undefined}
          accent
        />
        <StatTile
          label="用户总数"
          value={stats ? formatStatNumber(stats.userTotal) : "—"}
          delta={stats ? `窗口内新增 ${formatStatNumber(stats.userNew)}` : undefined}
        />
        <StatTile
          label="今日判读"
          value={stats ? formatStatNumber(stats.diagnosisToday) : "—"}
          delta={stats ? `待复核 ${formatStatNumber(stats.diagnosisAwaitingReview)}` : undefined}
        />
        <StatTile
          label="知识库文档"
          value={stats ? formatStatNumber(stats.knowledgeTotal) : "—"}
          delta={stats ? `切片 ${formatStatNumber(stats.knowledgeChunks)} 块` : undefined}
        />
      </section>

      <section className="admin-dashboard__charts" aria-label="趋势与分布">
        <TrendChart points={trendPoints} ariaLabel={`判读趋势 · 近 ${TREND_DAYS} 天`} />
        <RankedBars rows={distribution} ariaLabel="病种分布" />
      </section>

      <section className="admin-dashboard__records" aria-label="最近诊断记录">
        <h2 className="admin-dashboard__records-title">最近诊断记录</h2>
        <DataTable<AdminDiagnosis>
          columns={recentColumns}
          rows={recentRows}
          rowKey={(row) => row.id}
          loading={view.loading && recentRows.length === 0}
          emptyText="暂无判读记录"
          page={{ current: 1, pageSize: 5, total: recent?.total ?? 0 }}
          onPageChange={() => {}}
          hidePager
        />
      </section>

      {stats ? (
        <p className="admin-dashboard__note num">
          平均置信度 {formatStatPercent(stats.avgConfidence)} · 已复核{" "}
          {formatStatNumber(stats.diagnosisReviewed)} 条 · AI 拒识{" "}
          {formatStatNumber(stats.diagnosisAiRejected)} 条 · 资讯{" "}
          {formatStatNumber(stats.newsTotal)} 篇
        </p>
      ) : null}
    </div>
  )
}

export default AdminDashboardPage
