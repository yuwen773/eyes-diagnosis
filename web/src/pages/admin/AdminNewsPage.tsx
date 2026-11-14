import "@/styles/admin-polish-cms.css"

import { useMemo, useState, type FormEvent, type ReactElement } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  EyeOff,
  FileClock,
  Newspaper,
  Pencil,
  Send,
  Trash2,
} from "lucide-react"

import { useMediaQuery } from "@/lib/useMediaQuery"

import { AdminEmpty } from "@/components/admin/AdminEmpty"
import { AdminPageHead } from "@/components/admin/AdminPageHead"
import { RowMenu } from "@/components/admin/RowMenu"
import { DataTable, type Column, type SortState } from "@/components/admin/DataTable"
import { Modal } from "@/components/admin/Modal"
import { BatchBar } from "@/components/admin/BatchBar"
import { RiskTag } from "@/components/RiskTag"
import { FaultNote } from "@/components/fault"
import {
  changeNewsStatusBatch,
  deleteNews,
  deleteNewsBatch,
  listAdminNews,
  type AdminNews,
  type BatchResult,
  type NewsQuery,
} from "@/lib/adminApi"
import {
  newsStatusOptionsFor,
  newsStatusView,
  NEWS_STATUS_OPTIONS,
} from "@/lib/adminDomain"
import { newsExcerpt } from "@/lib/news"
import { describeError, type ErrorDetail } from "@/lib/api"
import { queryKeys } from "@/lib/queryKeys"
import { fault } from "@/lib/faults"

const DEFAULT_PAGE_SIZE = 10
const SUMMARY_LIMIT = 96

/** 已应用的筛选条件。 */
type Query = { title: string; status: string; startDate: string; endDate: string }
type Params = NewsQuery

/** 摘要截 96 字，超出补「…」；没有摘要时从正文开头取一段。 */
function truncateSummary(value?: string): string {
  if (!value) return "—"
  return value.length > SUMMARY_LIMIT ? `${value.slice(0, SUMMARY_LIMIT)}…` : value
}

/**
 * 状态动作的措辞与图标。
 *
 * 只覆盖后端状态机里真实存在的四个值（0 草稿 / 3 待审核 / 1 已发布 / 2 下架）；
 * 可选的目标状态一律由 newsStatusOptionsFor 给出，这里只管怎么写、画什么。
 */
const NEWS_STATUS_ACTION: Record<
  number,
  { verb: string; menu: string; icon: ReactElement }
> = {
  0: {
    verb: "转为草稿",
    menu: "转为草稿",
    icon: <FileClock size={14} strokeWidth={2} aria-hidden="true" />,
  },
  1: {
    verb: "发布",
    menu: "发布资讯",
    icon: <CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" />,
  },
  2: {
    verb: "下架",
    menu: "下架资讯",
    icon: <EyeOff size={14} strokeWidth={2} aria-hidden="true" />,
  },
  3: {
    verb: "送审",
    menu: "提交审核",
    icon: <Send size={14} strokeWidth={2} aria-hidden="true" />,
  },
}

/** 发布状态标签：语义色 + 文字，颜色只是第三重信息。 */
function NewsStatusTag({ status }: { status?: number | null }) {
  const view = newsStatusView(status)
  return (
    <span className="admin-cms__status">
      <RiskTag risk={view.risk}>{view.label}</RiskTag>
    </span>
  )
}

/**
 * 新闻管理（真实端点）。
 *
 * 结构逐字对齐用户管理页：取数事件驱动、唯一 load 由查询 / 重置 / 翻页 /
 * 删除成功后刷新调用，首次挂载只用一个 useEffect 加载一次；三态从 view 派生，
 * 用 requestSeq 递增序号挡住过期响应；删除走确认 Modal + deleting 锁；
 * 删除失败收起弹层、改用 FaultNote 页内读数。
 * 雪花 id 全程 string：列表 / 删除请求路径 / 跳编辑页都不做 Number(id) 转换。
 */
export function AdminNewsPage(): ReactElement {
  const navigate = useNavigate()
  // 下钻入口：仪表盘的「资讯待审核」带 ?status=3 进来，直接落到待审核筛选上。
  const [searchParams] = useSearchParams()
  const initialStatus = ((): string => {
    const value = searchParams.get("status")
    return value !== null && NEWS_STATUS_OPTIONS.some((option) => String(option.value) === value)
      ? value
      : ""
  })()

  // 输入草稿与「已应用的查询」分开：打字不触发请求，回车 / 查询按钮才提交。
  const [titleDraft, setTitleDraft] = useState("")
  const [statusDraft, setStatusDraft] = useState(initialStatus)
  const [startDraft, setStartDraft] = useState("")
  const [endDraft, setEndDraft] = useState("")
  const [query, setQuery] = useState<Query>({
    title: "",
    status: initialStatus,
    startDate: "",
    endDate: "",
  })
  const [page, setPage] = useState({ current: 1, pageSize: DEFAULT_PAGE_SIZE })
  // 服务端排序：字段必须落在后端白名单里。
  const [sort, setSort] = useState<SortState>(null)

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [deleteTarget, setDeleteTarget] = useState<AdminNews | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState<ErrorDetail | null>(null)
  const [actionNote, setActionNote] = useState<string | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)
  // 单行状态迁移中的行 id：那一行的菜单项置灰，避免连点重复提交。
  const [statusBusy, setStatusBusy] = useState<string | null>(null)

  const queryClient = useQueryClient()

  /** 已应用的筛选 + 分页：同时是查询键和请求体。 */
  const { current, pageSize } = page
  const params = useMemo<Params>(
    () => ({
      current,
      pageSize,
      ...(query.title ? { title: query.title } : {}),
      ...(query.status ? { status: Number(query.status) } : {}),
      ...(query.startDate ? { startDate: query.startDate } : {}),
      ...(query.endDate ? { endDate: query.endDate } : {}),
      ...(sort ? { sortField: sort.field, sortOrder: sort.order } : {}),
    }),
    [current, pageSize, query, sort],
  )

  const listQuery = useQuery({
    queryKey: queryKeys.admin.news(params),
    queryFn: () => listAdminNews(params),
  })
  const listFault = listQuery.error ? describeError(listQuery.error) : null

  /** 写操作成功后失效资讯域与统计域（待审核数在仪表盘上）。 */
  const refreshNews = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.newsAll }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.statsAll }),
    ])

  function onSearch(event: FormEvent) {
    event.preventDefault()
    setActionError(null)
    setQuery({
      title: titleDraft.trim(),
      status: statusDraft,
      startDate: startDraft,
      endDate: endDraft,
    })
    setPage((prev) => ({ ...prev, current: 1 }))
    setSelectedIds([])
  }

  function onReset() {
    setTitleDraft("")
    setStatusDraft("")
    setStartDraft("")
    setEndDraft("")
    setActionError(null)
    setQuery({ title: "", status: "", startDate: "", endDate: "" })
    setPage((prev) => ({ ...prev, current: 1 }))
    setSelectedIds([])
    setSort(null)
  }

  /**
   * 状态段控件：点一下即生效，不用再按「查询」。
   * 只改状态这一项，其余已应用的筛选保持不变。
   */
  function applyStatusFilter(value: string) {
    setStatusDraft(value)
    setActionError(null)
    setQuery((prev) => ({ ...prev, status: value }))
    setPage((prev) => ({ ...prev, current: 1 }))
    setSelectedIds([])
  }

  /** 单行状态迁移：合法目标状态由 newsStatusOptionsFor 给出，后端再校验一次。 */
  async function changeStatus(row: AdminNews, status: number) {
    const id = row.id
    if (!id || statusBusy) return
    setStatusBusy(id)
    setActionError(null)
    setActionNote(null)
    try {
      const result = await changeNewsStatusBatch([id], status)
      const failed = result.failed ?? 0
      if (failed > 0) {
        // 非法迁移由后端逐条裁决：这里如实回执，不假装成功。
        setActionNote(`状态未变更：${result.message ?? "该状态不允许此迁移"}`)
      } else {
        setActionNote(`${newsStatusView(status).label}：1 篇已更新。`)
        await refreshNews()
      }
    } catch (cause) {
      setActionError(describeError(cause))
    } finally {
      setStatusBusy(null)
    }
  }

  function onPageChange(next: { current: number; pageSize: number }) {
    // pageSize 变化一律回第 1 页（DataTable 已传 current:1，这里再钉死一次）。
    setActionError(null)
    setPage(
      next.pageSize !== page.pageSize
        ? { current: 1, pageSize: next.pageSize }
        : { current: next.current, pageSize: next.pageSize },
    )
    setSelectedIds([])
  }

  function openDelete(row: AdminNews) {
    setActionError(null)
    setDeleteTarget(row)
  }

  function closeDelete() {
    if (deleting) return
    setDeleteTarget(null)
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return
    const target = deleteTarget
    const id = target.id
    if (!id) return // 缺 id 的空白行不该发出带空路径的请求
    setDeleting(true)
    setActionError(null)
    try {
      await deleteNews(id) // 雪花 id 全程保持 string，绝不转成数字
      setDeleteTarget(null)
      setSelectedIds((prev) => prev.filter((item) => item !== id))
      await refreshNews()
    } catch (cause) {
      const detail = describeError(cause)
      setDeleteTarget(null) // 收起弹层，让页内提示露出来
      setActionError(detail)
    } finally {
      setDeleting(false)
    }
  }

  /** 批量动作：逐条执行，部分失败如实回执。 */
  async function runBatch(
    label: string,
    action: () => Promise<BatchResult>,
  ) {
    if (batchBusy || selectedIds.length === 0) return
    setBatchBusy(true)
    setActionError(null)
    setActionNote(null)
    try {
      const result = await action()
      const succeeded = result.succeeded ?? 0
      const failed = result.failed ?? 0
      setActionNote(
        failed > 0
          ? `${label}：成功 ${succeeded} 篇，失败 ${failed} 篇。${result.message ?? ""}`
          : `${label}：成功 ${succeeded} 篇。`,
      )
      if (failed === 0) setSelectedIds([])
      await refreshNews()
    } catch (cause) {
      setActionError(describeError(cause))
    } finally {
      setBatchBusy(false)
    }
  }

  const columns: Column<AdminNews>[] = [
    {
      key: "title",
      title: "标题 / 摘要",
      sortable: true,
      render: (row) => {
        // 摘要在后端就有（正文前 30 字）；没有摘要的老数据从正文开头取一段，
        // 口径与公开页一致，不另编一段话。
        const excerpt = newsExcerpt(row.content, row.summary, SUMMARY_LIMIT)
        return (
          <div className="admin-cms__titlecell">
            <span className="admin-cms__titlecell__main">{row.title || "未命名资讯"}</span>
            <span className="admin-cms__titlecell__sub" title={excerpt || undefined}>
              {truncateSummary(excerpt)}
            </span>
          </div>
        )
      },
    },
    {
      key: "status",
      title: "发布状态",
      // 列宽用百分比：表格随视口变宽时各列按比例走，标题列不会独吞
      // 整条余量（1920 档尤其明显），窄屏换卡片后这些宽度整体失效。
      width: "13%",
      sortable: true,
      // status 由后端 NewsVO 暴露（0 草稿 / 3 待审核 / 1 已发布 / 2 下架）；缺省读「未知」。
      render: (row) => (
        <div className="admin-cms__statuscell">
          <NewsStatusTag status={row.status} />
          {/* 下架原因：审核留痕，挂在状态下面，不另开一列。 */}
          {row.status === 2 && row.offlineReason ? (
            <span className="admin-cms__statusreason" title={row.offlineReason}>
              {row.offlineReason}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "publishTime",
      title: "作者 / 发布时间",
      width: "18%",
      sortable: true,
      render: (row) => (
        <div className="admin-cms__metacell">
          <span className="admin-cms__metacell__name">{row.author || "未署名"}</span>
          <span className="admin-cms__metacell__time num">{row.publishTime || "—"}</span>
        </div>
      ),
    },
    {
      key: "action",
      title: "操作",
      width: "12%",
      render: (row) => {
        // 可选目标状态只来自后端状态机：newsStatusOptionsFor 收窄，
        // 不在这里自己造一条迁移表。
        const targets = newsStatusOptionsFor(row.status).filter(
          (option) => option.value !== row.status,
        )
        return (
          <div className="admin-dt__row-actions admin-news__rowactions">
            {/* 主动作（编辑）收进图标按钮：窄屏下文字版会把操作列撑到
                盖住标题列；标签交给 title/aria-label。 */}
            <button
              type="button"
              className="admin-btn admin-btn--primary admin-btn--icon-sm"
              title="编辑资讯"
              aria-label={`编辑资讯：${row.title || "未命名资讯"}`}
              onClick={() => navigate(`/admin/news/${row.id}/edit`)}
            >
              <Pencil size={14} strokeWidth={2} aria-hidden="true" />
            </button>
            <RowMenu
              label={`更多资讯操作：${row.title || row.id}`}
              items={[
                ...targets.map((option) => ({
                  label: NEWS_STATUS_ACTION[option.value].menu,
                  icon: NEWS_STATUS_ACTION[option.value].icon,
                  disabled: !row.id || statusBusy === row.id,
                  onSelect: () => changeStatus(row, option.value),
                })),
                "separator" as const,
                {
                  label: "删除资讯",
                  icon: <Trash2 size={14} strokeWidth={2} aria-hidden="true" />,
                  danger: true,
                  disabled: !row.id,
                  onSelect: () => openDelete(row),
                },
              ]}
            />
          </div>
        )
      },
    },
  ]

  // 三态同源：loading / error / 数据都从同一个查询读；加载与出错时 rows 都是 undefined。
  const rows = listQuery.data?.records
  const total = listQuery.data?.total ?? 0
  const activeFilters =
    (query.title ? 1 : 0) +
    (query.status ? 1 : 0) +
    (query.startDate ? 1 : 0) +
    (query.endDate ? 1 : 0)

  // 390px 档：筛选面板默认收进一条紧凑工具栏，字段区折叠；
  // 已应用筛选数常驻可见，折叠态也不会骗用户「没有条件在生效」。
  const compact = useMediaQuery("(max-width: 640px)")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const showFields = !compact || filtersOpen

  return (
    <div className="admin-news">
      <AdminPageHead
        code="03"
        title="新闻管理"
        eyebrow="ADMIN · NEWS"
        description="管理资讯的草稿、审核与发布生命周期。编辑正文在独立的内容工作台完成。"
        meta={
          <span className="admin-filter__note num">
            {listQuery.data ? `共 ${total} 篇资讯` : "资讯数读取中"}
          </span>
        }
        actions={
          <button
            type="button"
            className="admin-btn admin-btn--primary admin-news__new"
            onClick={() => navigate("/admin/news/new/edit")}
          >
            <Pencil size={15} strokeWidth={2} aria-hidden="true" />
            新建资讯
          </button>
        }
      />

      <section className="admin-filter" aria-label="资讯筛选">
        <form className="admin-news__form" onSubmit={onSearch}>
          <div className="admin-filter__head">
            <h2 className="admin-filter__title">筛选</h2>
            {activeFilters > 0 ? (
              <span className="admin-filter__count num">已应用 {activeFilters} 项</span>
            ) : null}
            <div className="admin-filter__actions">
              {compact ? (
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  aria-expanded={filtersOpen}
                  onClick={() => setFiltersOpen((open) => !open)}
                >
                  {filtersOpen ? (
                    <ChevronUp size={14} strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
                  )}
                  {filtersOpen ? "收起筛选" : "展开筛选"}
                </button>
              ) : null}
              <button className="admin-btn admin-btn--primary" type="submit">
                查询
              </button>
              <button className="admin-btn admin-btn--ghost" type="button" onClick={onReset}>
                重置
              </button>
            </div>
          </div>
          {/* 发布状态是枚举：段控件一次点得中，不用先点开下拉才知道有哪些值。
              这一段常驻可见——最常用的筛选不该藏在「展开筛选」后面。 */}
          <div className="admin-cms__chipsgroup">
            <span className="admin-cms__chipslabel" id="admin-news-status-label">
              发布状态 · STATUS
            </span>
            <div
              className="admin-cms__chips"
              role="group"
              aria-labelledby="admin-news-status-label"
            >
              <button
                type="button"
                className="admin-cms__chip"
                aria-pressed={query.status === ""}
                onClick={() => applyStatusFilter("")}
              >
                全部状态
              </button>
              {NEWS_STATUS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="admin-cms__chip"
                  aria-pressed={query.status === String(option.value)}
                  onClick={() => applyStatusFilter(String(option.value))}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {showFields ? (
          <div className="admin-filter__fields admin-news__fields">
          <label className="admin-news__field">
            <span className="admin-news__label">标题 · TITLE</span>
            <input
              className="admin-news__input"
              type="text"
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              placeholder="按标题模糊检索…"
              aria-label="标题"
            />
          </label>
          <label className="admin-news__field admin-news__field--narrow">
            <span className="admin-news__label">发布自 · FROM</span>
            <input
              className="admin-news__input"
              type="date"
              value={startDraft}
              onChange={(event) => setStartDraft(event.target.value)}
              aria-label="发布时间起"
            />
          </label>
          <label className="admin-news__field admin-news__field--narrow">
            <span className="admin-news__label">发布至 · TO</span>
            <input
              className="admin-news__input"
              type="date"
              value={endDraft}
              onChange={(event) => setEndDraft(event.target.value)}
              aria-label="发布时间止"
            />
          </label>
          </div>
          ) : null}
        </form>
      </section>

      {actionError ? (
        <FaultNote
          className="admin-news__fault"
          fault={fault({
            severity: "attention",
            kind: "client",
            title: actionError.text,
            code: actionError.code,
          })}
        />
      ) : null}

      {actionNote ? <p className="admin-news__note num">{actionNote}</p> : null}

      <BatchBar count={selectedIds.length} onClear={() => setSelectedIds([])} label="资讯批量操作">
        <button
          type="button"
          className="admin-btn admin-btn--primary"
          disabled={batchBusy}
          onClick={() => runBatch("批量发布", () => changeNewsStatusBatch(selectedIds, 1))}
        >
          批量发布
        </button>
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          disabled={batchBusy}
          onClick={() => runBatch("批量下架", () => changeNewsStatusBatch(selectedIds, 2))}
        >
          批量下架
        </button>
        <button
          type="button"
          className="admin-btn admin-btn--danger"
          disabled={batchBusy}
          onClick={() => runBatch("批量删除", () => deleteNewsBatch(selectedIds))}
        >
          批量删除
        </button>
      </BatchBar>

      <section className="admin-news__table" aria-label="资讯列表">
        <DataTable<AdminNews>
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id ?? ""}
          loading={listQuery.isPending}
          error={listFault?.text ?? null}
          emptyText="暂无资讯"
          emptyContent={
            <AdminEmpty
              icon={Newspaper}
              title="还没有匹配的资讯"
              description={
                activeFilters > 0
                  ? "当前筛选条件下没有资讯。放宽标题、状态或发布时间后再看。"
                  : "还没有任何资讯。新建一篇后，它会先以草稿出现在这里。"
              }
            />
          }
          page={{ current: page.current, pageSize: page.pageSize, total }}
          onPageChange={onPageChange}
          sort={sort}
          onSortChange={(next) => {
            setActionError(null)
            setPage((prev) => ({ ...prev, current: 1 }))
            setSelectedIds([])
            setSort(next)
          }}
          selectable
          selectedKeys={selectedIds}
          onSelectionChange={setSelectedIds}
          isRowSelectable={(row) => !!row.id}
        />
      </section>

      <p className="admin-news__footer num">
        列出的是全站资讯（管理员视角）；发布状态由后端状态机裁决，非法迁移会被逐条拒绝
      </p>

      <Modal
        open={deleteTarget != null}
        title="删除资讯"
        onClose={closeDelete}
        footer={
          <>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={closeDelete}
              disabled={deleting}
            >
              取消
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--danger"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? "删除中…" : "确认删除"}
            </button>
          </>
        }
      >
        {deleteTarget ? (
          <p className="admin-news__modal-text">
            确定删除资讯{" "}
            <span className="admin-news__modal-title">{deleteTarget.title}</span>{" "}
            吗？删除后不可恢复。
          </p>
        ) : null}
      </Modal>
    </div>
  )
}

export default AdminNewsPage
