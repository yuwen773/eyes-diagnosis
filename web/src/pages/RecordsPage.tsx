import "@/styles/records.css"

import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  describeError,
  getMyDiagnosis,
  listMyDiagnoses,
  requestReexamine,
} from "@/lib/api"
import {
  loadMyStats,
  reexamineLabel,
  reexamineView,
  statsLabels,
  summarizeRecords,
  type ScopedStats,
} from "@/lib/records"
import { queryKeys } from "@/lib/queryKeys"
import { useSession } from "@/lib/session"
import {
  classCode,
  confidencePercent,
  formatTimestamp,
  severityLabel,
  severityRisk,
} from "@/lib/domain"
import { faultFromError } from "@/lib/faults"
import { useFault } from "@/components/fault"
import { RecordSheet } from "@/components/RecordSheet"
import { RiskTag } from "@/components/RiskTag"
import { EmptyFrame } from "@/components/EmptyFrame"
import { FaultPanel } from "@/components/FaultPanel"
import { SectionHead } from "@/components/SectionHead"
import { DisclaimerBar } from "@/components/DisclaimerBar"
import { ProductHeader } from "@/components/shell/ProductHeader"

const PAGE_SIZE = 10

export function RecordsPage() {
  const [page, setPage] = useState(1)
  const { push } = useFault()
  const queryClient = useQueryClient()
  const { status, scope } = useSession()
  /** 只有确认登录了才发个人请求：会话未知时不去猜，匿名时更不该问。 */
  const authed = status === "authed"

  /**
   * 列表：筛选 / 翻页就是换查询键，取数由 React Query 接管。
   * page 1 / pageSize 10 与个人中心同键，两页共享缓存。
   * 键里带 scope：换账号后 B 读的是另一个键，A 的缓存不会被 B 读到。
   */
  const listKey = queryKeys.records.mine(scope, { current: page, pageSize: PAGE_SIZE })
  const listQuery = useQuery({
    queryKey: listKey,
    queryFn: ({ signal }) =>
      listMyDiagnoses({ current: page, pageSize: PAGE_SIZE }, signal),
    enabled: authed,
  })

  const data = listQuery.data
  const records = useMemo(() => data?.records ?? [], [data])
  // 首次加载与「失败后重试」都算加载态；重试期间先收起故障面板，回到骨架。
  const loading = listQuery.isPending || (listQuery.isFetching && data === undefined)
  // 后台重取失败时保留已有列表，只有拿不到数据才整块出故障面板。
  const fault =
    !loading && data === undefined && listQuery.error
      ? describeError(listQuery.error)
      : null

  // 服务端聚合优先；接口未上线或失败时 loadMyStats 自己降级到本页。
  const statsQuery = useQuery({
    queryKey: [...listKey, "stats"] as const,
    queryFn: ({ signal }) => loadMyStats(records, data?.total ?? 0, signal),
    enabled: authed && data !== undefined,
  })
  const scoped: ScopedStats | null = statsQuery.data ?? null

  const stats = scoped?.stats ?? summarizeRecords(records, data?.total ?? 0)
  const labels = statsLabels(scoped?.scope ?? "page")

  /** 展开的记录详情。同一时刻只开一条。 */
  const [openId, setOpenId] = useState<string | null>(null)
  /** 本次会话里刚提交过复诊的记录 id：列表重取落地前先把行内状态翻成「复审中」。 */
  const [reexaminedId, setReexaminedId] = useState<string | null>(null)
  const [submittingId, setSubmittingId] = useState<string | null>(null)

  const detailQuery = useQuery({
    queryKey: queryKeys.records.detail(scope, openId ?? ""),
    queryFn: ({ signal }) => getMyDiagnosis(openId as string, signal),
    enabled: authed && openId !== null,
  })
  const detailLoading =
    openId !== null &&
    (detailQuery.isPending || (detailQuery.isFetching && detailQuery.data === undefined))
  // 同理：后台重取失败时保留已读出的记录纸。
  const detailFault =
    !detailLoading && detailQuery.data === undefined && detailQuery.error
      ? describeError(detailQuery.error)
      : null

  async function submitReexamine(id: string) {
    setSubmittingId(id)
    try {
      await requestReexamine(id)
      setReexaminedId(id)
      // 行内状态跟着翻：列表重取后 reexamineStatus 变 2，无需手工改缓存。
      void queryClient.invalidateQueries({ queryKey: listKey, exact: true })
    } catch (cause) {
      push(faultFromError(cause, { intent: "generic", action: { label: "重试", run: () => void submitReexamine(id) } }))
    } finally {
      setSubmittingId(null)
    }
  }

  function closeDetail() {
    setOpenId(null)
  }

  function openDetail(id: string) {
    setOpenId(id)
  }

  function toggle(id: string) {
    if (openId === id) closeDetail()
    else openDetail(id)
  }

  function retry() {
    closeDetail()
    void listQuery.refetch()
  }

  function goPage(next: number) {
    closeDetail()
    setPage(next)
  }

  const pages = Math.max(1, data?.pages ?? 1)

  if (status === "anon") {
    // 匿名：整页都是个人数据，不发请求，也不假装「没有记录」——给登录入口。
    return (
      <div className="is-field">
        <ProductHeader scene="clinical" />
        <main className="wrap records">
          <SectionHead code="04" kicker="诊断记录" en="RECORDS · MY READINGS" />
          <div className="records__empty">
            <EmptyFrame label="未登录" />
            <p className="records__empty-title">登录后才能查看诊断记录</p>
            <p className="records__empty-body">记录、统计与复核状态都跟着账号走。</p>
            <Link className="btn" to="/login?redirect=%2Frecords">
              去登录 <span className="btn__key">↗</span>
            </Link>
          </div>
        </main>
        <DisclaimerBar />
      </div>
    )
  }

  return (
    <div className="is-field">
      <ProductHeader scene="clinical" />

      <main className="wrap records">
        <SectionHead code="04" kicker="诊断记录" en="RECORDS · MY READINGS" />

        <div className="records__intro">
          <p className="overline">Ledger · 判读台账</p>
          <h1 className="display records__title">诊断记录</h1>
          <p className="lead">
            你名下所有的判读，每一条都保留模型版本与权重指纹。点开一条，展开就是那张记录纸。
          </p>
        </div>

        <div className="strip records__strip">
          <div className="strip__cell">
            <div className="readout">
              <span className="readout__label">{labels.total}</span>
              <span className="readout__value num">{stats.total}</span>
            </div>
          </div>
          <div className="strip__cell">
            <div className="readout">
              <span className="readout__label">{labels.highRisk}</span>
              <span className="readout__value num">{stats.highRisk}</span>
            </div>
          </div>
          <div className="strip__cell">
            <div className="readout">
              <span className="readout__label">{labels.awaitingReview}</span>
              <span className="readout__value num">{stats.awaitingReview}</span>
            </div>
          </div>
          <div className="strip__cell">
            <div className="readout">
              <span className="readout__label">{labels.lastReadAt}</span>
              <span className="readout__value readout__value--mono">
                {stats.lastReadAt ? formatTimestamp(stats.lastReadAt) : "—"}
              </span>
            </div>
          </div>
        </div>

        {scoped?.scope === "all" ? null : (
          <p className="records__scope">
            总数是你名下的全部判读；带「本页」的三项只统计当前这一页（第 {page} / {pages}
            页），翻页会变。服务端聚合上线后会自动切到全量。
          </p>
        )}

        {fault ? (
          <FaultPanel
            code={fault.code}
            title="判读台账没有读出来"
            body={fault.text}
            endpoint="POST /diagnosis/list/page/my"
            onRetry={retry}
          />
        ) : null}

        {!fault && loading ? (
          <div className="records__skeleton" aria-hidden="true">
            {Array.from({ length: 5 }, (_, index) => (
              <div className="records__skeleton-row" key={index} />
            ))}
          </div>
        ) : null}

        {!fault && !loading && records.length === 0 ? (
          <div className="records__empty">
            <EmptyFrame label="暂无判读" />
            <p className="records__empty-title">还没有属于你的判读</p>
            <p className="records__empty-body">
              上传一张眼底影像开始第一次判读，记录会按时间倒序落在这本台账里。
            </p>
            <Link className="btn" to="/diagnosis">
              去判读 <span className="btn__key">↗</span>
            </Link>
          </div>
        ) : null}

        {!fault && !loading && records.length > 0 ? (
          <>
            <ul className="records__list">
              {records.map((item, index) => (
                <li key={item.id} className="records__item">
                  <button
                    type="button"
                    className="records__row"
                    data-cursor
                    aria-expanded={openId === item.id}
                    onClick={() => toggle(item.id)}
                  >
                    <span className="records__index num">
                      {String((page - 1) * PAGE_SIZE + index + 1).padStart(2, "0")}
                    </span>

                    <span className="records__thumb" aria-hidden="true">
                      {item.url ? (
                        <img src={item.url} alt="" loading="lazy" />
                      ) : (
                        <span className="records__thumb-none num">无影像</span>
                      )}
                    </span>

                    <span className="records__main">
                      <span className="records__disease">
                        {item.aiRejected ? "AI 拒识" : item.result || "未给出判读结果"}
                        <span className="records__code num">{classCode(item.result ?? undefined)}</span>
                      </span>
                      <span className="records__meta">
                        <span className="num">{formatTimestamp(item.createTime)}</span>
                        <span>·</span>
                        <span>{reexamineLabel(item.reexamineStatus)}</span>
                        {item.requiresReview && !item.aiRejected ? (
                          <>
                            <span>·</span>
                            <span>待人工复核</span>
                          </>
                        ) : null}
                      </span>
                    </span>

                    <span className="records__readout">
                      {item.aiRejected ? (
                        <RiskTag risk="critical">拒识</RiskTag>
                      ) : (
                        <>
                          <span className="readout__label">置信度</span>
                          <span className="records__conf num">{confidencePercent(item.confidence)}</span>
                          <RiskTag risk={severityRisk(item.severity ?? undefined)}>
                            {severityLabel(item.severity ?? undefined)}
                          </RiskTag>
                        </>
                      )}
                    </span>

                    <span className="records__caret" aria-hidden="true">
                      {openId === item.id ? "−" : "+"}
                    </span>
                  </button>

                  {openId === item.id ? (
                    <div className="records__detail">
                      {detailLoading ? (
                        <div className="records__detail-loading num">读取中…</div>
                      ) : detailFault ? (
                        <FaultPanel
                          code={detailFault.code}
                          title="这条记录没有读出来"
                          body={detailFault.text}
                          endpoint={`GET /diagnosis/get/${item.id}`}
                          onRetry={() => void detailQuery.refetch()}
                        />
                      ) : detailQuery.data ? (
                        <>
                          <RecordSheet
                            result={detailQuery.data}
                            recordId={`IRIS-${item.id}`}
                            imageSrc={item.url ?? detailQuery.data.url}
                            tone="paper"
                          />
                          {(() => {
                            const view = reexamineView(item, reexaminedId === item.id)
                            if (!view) return null
                            if (view === "receipt") {
                              return (
                                <div className="records__actions">
                                  <span className="records__actions-done">
                                    <RiskTag risk="attention">复审中</RiskTag>
                                    申请已提交，等待医生安排复诊。
                                  </span>
                                </div>
                              )
                            }
                            return (
                              <div className="records__actions">
                                {view === "reviewed" ? (
                                  <RiskTag risk="normal">已复审</RiskTag>
                                ) : null}
                                <button
                                  type="button"
                                  className="btn"
                                  disabled={submittingId === item.id}
                                  onClick={() => void submitReexamine(item.id)}
                                >
                                  {submittingId === item.id
                                    ? "提交中…"
                                    : view === "reviewed"
                                      ? "再次申请复诊"
                                      : "申请复诊"}
                                  <span className="btn__key">↻</span>
                                </button>
                                <span className="records__actions-note">
                                  提交后这条记录进入复诊队列，状态变为「复审中」。
                                </span>
                              </div>
                            )
                          })()}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>

            <div className="news__pager">
              <button
                type="button"
                className="news__pager-step"
                disabled={page <= 1}
                onClick={() => goPage(page - 1)}
              >
                ← 上一页
              </button>
              <span className="news__pager-state num">
                {page} / {pages} · 共 {stats.total} 条
              </span>
              <button
                type="button"
                className="news__pager-step"
                disabled={page >= pages}
                onClick={() => goPage(page + 1)}
              >
                下一页 →
              </button>
            </div>
          </>
        ) : null}
      </main>

      <DisclaimerBar />
    </div>
  )
}
