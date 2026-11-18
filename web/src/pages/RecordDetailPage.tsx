import "@/styles/records.css"

import { Link, Navigate, useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { describeError, getMyDiagnosis } from "@/lib/api"
import { queryKeys } from "@/lib/queryKeys"
import { useSession } from "@/lib/session"
import { canonicalClassName, classCode, formatTimestamp } from "@/lib/domain"
import { RecordSheet } from "@/components/RecordSheet"
import { FaultPanel } from "@/components/FaultPanel"
import { DisclaimerBar } from "@/components/DisclaimerBar"
import { ProductHeader } from "@/components/shell/ProductHeader"

/**
 * 正式判读报告（独立路由 `/records/:id`）。
 *
 * <p>列表负责追溯，报告负责核验：报告必须能直接打开、刷新后重新取到，
 * 不能只存在于列表的展开状态里。`RecordSheet` 仍是唯一的正式报告组件。
 *
 * <p>后端自带归属校验（`/diagnosis/get/{id}` 只返回本人记录），
 * 这里不另做客户端过滤，也不把读不到的原因猜成「不存在」。
 */
export function RecordDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { status, scope } = useSession()
  const authed = status === "authed"

  const query = useQuery({
    queryKey: queryKeys.records.detail(scope, id ?? ""),
    queryFn: ({ signal }) => getMyDiagnosis(id as string, signal),
    enabled: authed && Boolean(id),
  })

  if (!id) return <Navigate to="/records" replace />

  if (status === "anon") {
    return (
      <div className="is-field is-brand-page">
        <ProductHeader scene="clinical" />
        <main className="wrap records">
          <div className="records__empty">
            <p className="records__empty-title">登录后才能查看这份报告</p>
            <p className="records__empty-body">报告只对记录归属人有权限。</p>
            <Link className="btn" to={`/login?redirect=${encodeURIComponent(`/records/${id}`)}`}>
              去登录
            </Link>
          </div>
        </main>
        <DisclaimerBar />
      </div>
    )
  }

  const loading = query.isPending || (query.isFetching && query.data === undefined)
  const fault = !loading && query.data === undefined && query.error ? describeError(query.error) : null
  const data = query.data

  return (
    <div className="is-field is-brand-page">
      <ProductHeader scene="clinical" />

      <main className="wrap records report">
        <nav className="report__crumb no-print" aria-label="面包屑">
          <Link className="link" to="/records">
            ← 判读记录
          </Link>
        </nav>

        {loading ? (
          <div className="records__skeleton" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="records__skeleton-row" key={index} />
            ))}
          </div>
        ) : null}

        {fault ? (
          <FaultPanel
            code={fault.code}
            title="这份报告没有读出来"
            body={fault.text}
            endpoint={`GET /diagnosis/get/${id}`}
            onRetry={() => void query.refetch()}
          />
        ) : null}

        {data ? (
          <>
            <header className="report__head no-print">
              <p className="overline">Reading Report · 正式报告</p>
              <h1 className="report__title">
                {data.aiRejected
                  ? "拒识记录"
                  : canonicalClassName(data.result ?? undefined) ?? data.result ?? "判读报告"}
              </h1>
              <p className="report__meta">
                {data.result && !data.aiRejected
                  ? `${classCode(data.result ?? undefined) ?? ""} · `
                  : ""}
                记录编号 IRIS-{id}
                {data.createTime ? ` · ${formatTimestamp(data.createTime)}` : ""}
              </p>
            </header>

            <RecordSheet
              result={data}
              recordId={`IRIS-${id}`}
              imageSrc={data.url}
              actions={
                <>
                  <button className="btn btn--ghost btn--sm" type="button" onClick={() => window.print()}>
                    打印报告
                  </button>
                  <Link className="link" to="/records" style={{ marginLeft: "auto" }}>
                    返回记录
                  </Link>
                </>
              }
            />

            <p className="report__note no-print">
              复诊申请在记录列表里提交：这条记录进入复诊队列后，复诊状态会随之更新。
            </p>
          </>
        ) : null}
      </main>

      <DisclaimerBar />
    </div>
  )
}
