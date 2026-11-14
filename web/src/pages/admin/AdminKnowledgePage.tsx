import "@/styles/admin-document.css"

import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
} from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"
import { ChevronDown, ChevronUp, Eye, FileText, Pencil, Trash2 } from "lucide-react"

import { useMediaQuery } from "@/lib/useMediaQuery"

import { AdminEmpty } from "@/components/admin/AdminEmpty"
import { AdminPageHead } from "@/components/admin/AdminPageHead"
import { RowMenu } from "@/components/admin/RowMenu"
import { DataTable, type Column } from "@/components/admin/DataTable"
import { Modal } from "@/components/admin/Modal"
import { KnowledgeWorkspace } from "@/components/admin/KnowledgeWorkspace"
import { BatchBar } from "@/components/admin/BatchBar"
import { RiskTag } from "@/components/RiskTag"
import { FaultNote } from "@/components/fault"
import {
  deleteKnowledge,
  deleteKnowledgeBatch,
  listKnowledge,
  updateKnowledgeTitle,
  uploadKnowledge,
  type KnowledgeDoc,
  type KnowledgeQuery,
} from "@/lib/adminApi"
import {
  knowledgeStatusView,
  KNOWLEDGE_FILE_TYPE_OPTIONS,
  KNOWLEDGE_STATUS_FILTER_OPTIONS,
} from "@/lib/adminDomain"
import { describeError, type ErrorDetail } from "@/lib/api"
import { queryKeys } from "@/lib/queryKeys"
import { formatTimestamp } from "@/lib/domain"
import { fault } from "@/lib/faults"

const DEFAULT_PAGE_SIZE = 10
const POLL_MS = 3000
const ACCEPT = ".pdf,.doc,.docx,.txt,.md,.markdown"

/** 已应用的筛选条件。 */
type Query = {
  fileName: string
  title: string
  status: string
  fileType: string
  startDate: string
  endDate: string
}

/** 文件大小 B / KB / MB 格式化函数（brief 逐字）。数值列统一 mono。 */
function formatFileSize(bytes?: string | number): string {
  const size = Number(bytes)
  if (!size || size < 0 || !Number.isFinite(size)) return "—"
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 知识库（真实端点：上传 / 轮询 / 预览 / 删除 / 改名）。
 *
 * 取数逐字对齐 AdminUsersPage：requestSeq 递增序号挡过期响应，View 三态同源派生，
 * 首次挂载只用一个 useEffect 发一次请求；事件驱动 startLoad 在事件里同步置 loading。
 * 所有 setState 都在 Promise 续体（applyLoaded / applyFailed）里，effect 体内不写 state，
 * 符合 react-hooks/set-state-in-effect。
 *
 * 轮询（brief 硬性要求 / Review Focus #2）用「列表是否存在 status===0」这一个开关：
 * hasProcessing 为 true 时 3s setInterval 静默重拉，false 时停；单一 effect 以
 * hasProcessing / page / fireLoad 为依赖，React 保证同一时刻只有一个活跃 effect，
 * 每次重跑前必先跑上一轮 cleanup（clearInterval），StrictMode 双挂载也不会泄漏；
 * pollTimerRef 再挡一道重入，组件卸载走同一 cleanup 清定时器。
 */
export function AdminKnowledgePage(): ReactElement {
  // 下钻入口：仪表盘的「知识库处理失败」带 ?status=2 进来，直接落到失败筛选上。
  // 只认合法的状态码，其余忽略。
  const [searchParams] = useSearchParams()
  const initialStatus = ((): string => {
    const value = searchParams.get("status")
    return value !== null && KNOWLEDGE_STATUS_FILTER_OPTIONS.some((o) => o.value === value)
      ? value
      : ""
  })()
  const [fileNameDraft, setFileNameDraft] = useState("")
  const [titleDraft, setTitleDraft] = useState("")
  const [statusDraft, setStatusDraft] = useState(initialStatus)
  const [fileTypeDraft, setFileTypeDraft] = useState("")
  const [startDraft, setStartDraft] = useState("")
  const [endDraft, setEndDraft] = useState("")
  const [query, setQuery] = useState<Query>({
    fileName: "",
    title: "",
    status: initialStatus,
    fileType: "",
    startDate: "",
    endDate: "",
  })
  const [page, setPage] = useState({ current: 1, pageSize: DEFAULT_PAGE_SIZE })

  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 本次会话上传过的文件名：用于「处理中」条立即显示，列表回来后再按服务端状态收口。
  const [uploadedNames, setUploadedNames] = useState<string[]>([])

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeDoc | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState<ErrorDetail | null>(null)
  const [actionNote, setActionNote] = useState<string | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)

  // 预览抽屉：元信息 + 原文阅读 + 切片清单。详情查询在 KnowledgeWorkspace 内。
  const [previewTarget, setPreviewTarget] = useState<KnowledgeDoc | null>(null)

  // 改名弹层
  const [renameTarget, setRenameTarget] = useState<KnowledgeDoc | null>(null)
  const [renameTitle, setRenameTitle] = useState("")
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<ErrorDetail | null>(null)

  const queryClient = useQueryClient()

  /** 已应用的筛选 + 分页：同时是查询键和请求体。 */
  const { current, pageSize } = page
  const params = useMemo<KnowledgeQuery>(
    () => ({
      current,
      pageSize,
      ...(query.fileName ? { fileName: query.fileName } : {}),
      ...(query.title ? { title: query.title } : {}),
      ...(query.status ? { status: Number(query.status) } : {}),
      ...(query.fileType ? { fileType: query.fileType } : {}),
      ...(query.startDate ? { startDate: query.startDate } : {}),
      ...(query.endDate ? { endDate: query.endDate } : {}),
    }),
    [current, pageSize, query],
  )

  const listQuery = useQuery({
    queryKey: queryKeys.admin.knowledge(params),
    queryFn: () => listKnowledge(params),
    // 列表里还有 status===0 的文档时 3 秒静默重拉；后台刷新不清空数据、
    // 不把页面打回 loading，这就是原来自研轮询想达到的效果。
    refetchInterval: (q) =>
      (q.state.data?.records ?? []).some((doc) => doc.status === 0) ? POLL_MS : false,
  })
  const listData = listQuery.data
  const listFault = listQuery.error ? describeError(listQuery.error) : null

  /**
   * 「处理中」文件名：本次上传过、且服务端仍标记 status===0。
   * 只认列表里真实存在的行：文档被翻到别的页或处理完成后，条目自然消失，
   * 不会留下永远「处理中」的幽灵名。
   */
  const processingNames = useMemo(() => {
    const status = new Map((listData?.records ?? []).map((doc) => [doc.fileName, doc.status]))
    return uploadedNames.filter((name) => status.get(name) === 0)
  }, [uploadedNames, listData])

  /** 写操作成功后失效知识库域与统计域（失败文档数在仪表盘上）。 */
  const refreshKnowledge = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.knowledgeAll }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.statsAll }),
    ])

  function onSearch(event: FormEvent) {
    event.preventDefault()
    setActionError(null)
    setQuery({
      fileName: fileNameDraft.trim(),
      title: titleDraft.trim(),
      status: statusDraft,
      fileType: fileTypeDraft,
      startDate: startDraft,
      endDate: endDraft,
    })
    setPage((prev) => ({ ...prev, current: 1 }))
    setSelectedIds([])
  }

  function onReset() {
    setFileNameDraft("")
    setTitleDraft("")
    setStatusDraft("")
    setFileTypeDraft("")
    setStartDraft("")
    setEndDraft("")
    setActionError(null)
    setQuery({ fileName: "", title: "", status: "", fileType: "", startDate: "", endDate: "" })
    setPage((prev) => ({ ...prev, current: 1 }))
    setSelectedIds([])
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

  function onPickFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? [])
    if (picked.length > 0) setPendingFiles((prev) => [...prev, ...picked])
    event.target.value = "" // 允许再次选择同名文件
  }

  function removePending(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index))
  }

  async function startUpload() {
    if (pendingFiles.length === 0 || uploading) return
    const files = pendingFiles
    setUploading(true)
    setActionError(null)
    try {
      await uploadKnowledge(files)
      // 清待传：只移除这次真正上传的 File 对象，上传期间新选择的文件仍留在待传列表。
      setPendingFiles((prev) => prev.filter((file) => !files.includes(file)))
      setUploadedNames((prev) => [...new Set([...prev, ...files.map((file) => file.name)])])
      await refreshKnowledge()
    } catch (cause) {
      // 上传失败：FaultNote 页内读数 + 保留待传列表，用户可直接重试。
      setActionError(describeError(cause))
    } finally {
      setUploading(false)
    }
  }

  function openDelete(row: KnowledgeDoc) {
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
    setDeleting(true)
    setActionError(null)
    try {
      await deleteKnowledge(target.id) // 后端 JsonConfig 全局 Long→String，id 线上为 string，直接传
      setDeleteTarget(null)
      setSelectedIds((prev) => prev.filter((id) => id !== target.id))
      setUploadedNames((prev) => prev.filter((name) => name !== target.fileName))
      await refreshKnowledge()
    } catch (cause) {
      setDeleteTarget(null) // 收起弹层，让页内提示露出来
      setActionError(describeError(cause))
    } finally {
      setDeleting(false)
    }
  }

  /** 批量删除：逐条鉴权与执行，部分失败如实回执。 */
  async function runBatchDelete() {
    if (batchBusy || selectedIds.length === 0) return
    setBatchBusy(true)
    setActionError(null)
    setActionNote(null)
    try {
      const result = await deleteKnowledgeBatch(selectedIds)
      const succeeded = result.succeeded ?? 0
      const failed = result.failed ?? 0
      setActionNote(
        failed > 0
          ? `批量删除：成功 ${succeeded} 份，失败 ${failed} 份。${result.message ?? ""}`
          : `批量删除：成功 ${succeeded} 份。`,
      )
      if (failed === 0) setSelectedIds([])
      await refreshKnowledge()
    } catch (cause) {
      setActionError(describeError(cause))
    } finally {
      setBatchBusy(false)
    }
  }

  /* ── 预览（原文 + 切片） ───────────────────────────────── */

  function openPreview(row: KnowledgeDoc) {
    setPreviewTarget(row)
  }

  function closePreview() {
    setPreviewTarget(null)
  }

  /* ── 改名 ───────────────────────────────────────────────── */

  function openRename(row: KnowledgeDoc) {
    setRenameTitle(row.title ?? row.fileName ?? "")
    setRenameError(null)
    setRenameTarget(row)
  }

  function closeRename() {
    if (renaming) return
    setRenameTarget(null)
    setRenameError(null)
  }

  async function confirmRename() {
    if (!renameTarget || renaming) return
    const title = renameTitle.trim()
    if (!title) {
      setRenameError({ code: 40000, text: "标题不能为空" })
      return
    }
    setRenaming(true)
    setRenameError(null)
    try {
      await updateKnowledgeTitle(renameTarget.id, title)
      setRenameTarget(null)
      setActionNote("已改名")
      await refreshKnowledge()
    } catch (cause) {
      setRenameError(describeError(cause))
    } finally {
      setRenaming(false)
    }
  }

  const columns: Column<KnowledgeDoc>[] = [
    {
      key: "fileName",
      title: "文档",
      // 弹性列也要给底宽：表格 min-width 740 里它拿 172px，否则自动布局
      // 会把文件名列挤成 0 宽竖条，行高跟着爆掉。
      width: "172px",
      render: (row) => (
        <div className="admin-file-cell">
          <span className="admin-file-cell__icon" aria-hidden="true">
            <FileText size={16} strokeWidth={1.8} />
          </span>
          <span className="admin-file-cell__text">
            <span className="admin-file-cell__name">{row.fileName || "未命名文件"}</span>
            <span
              className="admin-file-cell__sub"
              title={`${(row.fileType || "—").toUpperCase()} · ${formatFileSize(row.fileSize)}`}
            >
              {(row.fileType || "—").toUpperCase()} · {formatFileSize(row.fileSize)}
            </span>
          </span>
        </div>
      ),
    },
    { key: "title", title: "标题", width: "180px" },
    { key: "chunkCount", title: "分块数", width: "88px", mono: true },
    {
      key: "status",
      title: "状态",
      width: "112px",
      render: (row) => {
        const v = knowledgeStatusView(row.status)
        return <RiskTag risk={v.risk}>{v.label}</RiskTag>
      },
    },
    {
      key: "createTime",
      title: "上传时间",
      width: "164px",
      mono: true,
      render: (row) => formatTimestamp(row.createTime),
    },
    {
      key: "action",
      title: "操作",
      width: "176px",
      render: (row) => (
        <div className="admin-dt__row-actions">
          {/* 主动作（预览）收进图标按钮：窄屏下文字版会把操作列撑到
              盖住文件名列；标签交给 title/aria-label。 */}
          <button
            type="button"
            className="admin-btn admin-btn--primary admin-btn--icon-sm"
            title="预览文档"
            aria-label="预览文档"
            onClick={() => openPreview(row)}
          >
            <Eye size={14} strokeWidth={2} aria-hidden="true" />
          </button>
          <RowMenu
            label={`更多文档操作：${row.fileName || row.id}`}
            items={[
              {
                label: "改名",
                icon: <Pencil size={14} strokeWidth={2} aria-hidden="true" />,
                onSelect: () => openRename(row),
              },
              {
                label: "删除文档",
                icon: <Trash2 size={14} strokeWidth={2} aria-hidden="true" />,
                danger: true,
                onSelect: () => openDelete(row),
              },
            ]}
          />
        </div>
      ),
    },
  ]

  // 三态同源：loading / error / 数据都从 view 读；加载与出错时 rows 都是 undefined。
  const rows = listData?.records
  const total = listData?.total ?? 0
  // 静默轮询失败不该把已有列表换成错误页；只有一次数据都没拿到才报错。
  const listError = listData === undefined ? (listFault?.text ?? null) : null
  const activeFilters = Object.values(query).filter(Boolean).length

  // 390px 档：筛选面板默认收进一条紧凑工具栏，字段区折叠；
  // 已应用筛选数常驻可见，折叠态也不会骗用户「没有条件在生效」。
  const compact = useMediaQuery("(max-width: 640px)")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const showFields = !compact || filtersOpen

  return (
    <div className="admin-knowledge">
      <AdminPageHead
        code="05"
        title="知识库"
        eyebrow="ADMIN · KNOWLEDGE"
        description="上传、解析并向量化医疗文档，管理 RAG 切片与处理状态。"
        meta={
          <span className="admin-filter__note num">
            {listData ? `共 ${total} 份文档` : "文档数读取中"}
          </span>
        }
      />

      <section className="admin-filter" aria-label="知识库筛选与上传">
        <form className="admin-knowledge__form" onSubmit={onSearch}>
          <div className="admin-filter__head">
            <h2 className="admin-filter__title">筛选与上传</h2>
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
          {showFields ? (
          <div className="admin-filter__fields">
          <label className="admin-knowledge__field">
            <span className="admin-knowledge__label">文件名 · FILE</span>
            <input
              className="admin-knowledge__input"
              type="text"
              value={fileNameDraft}
              onChange={(event) => setFileNameDraft(event.target.value)}
              placeholder="按文件名模糊检索…"
              aria-label="文件名"
            />
          </label>
          <label className="admin-knowledge__field">
            <span className="admin-knowledge__label">标题 · TITLE</span>
            <input
              className="admin-knowledge__input"
              type="text"
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              placeholder="按标题模糊检索…"
              aria-label="标题"
            />
          </label>
          <label className="admin-knowledge__field admin-knowledge__field--narrow">
            <span className="admin-knowledge__label">状态 · STATUS</span>
            <select
              className="admin-knowledge__input"
              value={statusDraft}
              onChange={(event) => setStatusDraft(event.target.value)}
              aria-label="处理状态"
            >
              {KNOWLEDGE_STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-knowledge__field admin-knowledge__field--narrow">
            <span className="admin-knowledge__label">类型 · TYPE</span>
            <select
              className="admin-knowledge__input"
              value={fileTypeDraft}
              onChange={(event) => setFileTypeDraft(event.target.value)}
              aria-label="文件类型"
            >
              {KNOWLEDGE_FILE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-knowledge__field admin-knowledge__field--narrow">
            <span className="admin-knowledge__label">上传自 · FROM</span>
            <input
              className="admin-knowledge__input"
              type="date"
              value={startDraft}
              onChange={(event) => setStartDraft(event.target.value)}
              aria-label="上传时间起"
            />
          </label>
          <label className="admin-knowledge__field admin-knowledge__field--narrow">
            <span className="admin-knowledge__label">上传至 · TO</span>
            <input
              className="admin-knowledge__input"
              type="date"
              value={endDraft}
              onChange={(event) => setEndDraft(event.target.value)}
              aria-label="上传时间止"
            />
          </label>
          </div>
          ) : null}
        </form>

        <div className="admin-knowledge__upload-row">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="admin-knowledge__file-input"
            onChange={onPickFiles}
            aria-label="选择知识库文件"
          />
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => fileInputRef.current?.click()}
          >
            选择文件
          </button>
          <span className="admin-knowledge__hint num">PDF / DOC / DOCX / TXT / MD · 可多选</span>
          <div className="admin-knowledge__upload-actions">
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              onClick={startUpload}
              disabled={pendingFiles.length === 0 || uploading}
            >
              {uploading ? "上传中…" : "开始上传"}
            </button>
          </div>
        </div>

        {pendingFiles.length > 0 ? (
          <div className="admin-knowledge__pending">
            <span className="admin-knowledge__pending-label num">
              待上传 · {pendingFiles.length} 个文件
            </span>
            <ul className="admin-knowledge__chips">
              {pendingFiles.map((file, index) => (
                <li key={`${file.name}-${index}`} className="admin-knowledge__chip">
                  <span className="admin-knowledge__chip-name">{file.name}</span>
                  <button
                    type="button"
                    className="admin-knowledge__chip-remove"
                    onClick={() => removePending(index)}
                    aria-label={`移除 ${file.name}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {/* 上传 / 删除失败的页内读数：describeError → fault → FaultNote，语法全站一致。 */}
      {actionError ? (
        <FaultNote
          className="admin-knowledge__fault"
          fault={fault({
            severity: "attention",
            kind: "client",
            title: actionError.text,
            code: actionError.code,
          })}
        />
      ) : null}

      {actionNote ? <p className="admin-knowledge__note num">{actionNote}</p> : null}

      {/* 处理中条：显示本次会话新上传、服务端仍在处理的文件名；全部完成自动收起。 */}
      {processingNames.length > 0 ? (
        <section className="admin-knowledge__processing" aria-label="处理中文件">
          <p className="admin-knowledge__processing-head num">
            处理中 · {processingNames.length} 个文件正在解析并向量化
          </p>
          <ul className="admin-knowledge__processing-list">
            {processingNames.map((name) => (
              <li key={name} className="admin-knowledge__processing-item">
                <span className="admin-knowledge__processing-name">{name}</span>
                <RiskTag risk="attention">解析中</RiskTag>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <BatchBar count={selectedIds.length} onClear={() => setSelectedIds([])} label="知识文档批量操作">
        <button
          type="button"
          className="admin-btn admin-btn--danger"
          disabled={batchBusy}
          onClick={runBatchDelete}
        >
          批量删除
        </button>
      </BatchBar>

      <section className="admin-knowledge__table" aria-label="知识文档列表">
        <DataTable<KnowledgeDoc>
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={listQuery.isPending}
          error={listError}
          emptyText="暂无文档"
          emptyContent={
            <AdminEmpty
              icon={FileText}
              title="知识库里还没有文档"
              description={
                activeFilters > 0
                  ? "当前筛选条件下没有文档。放宽文件名、状态或上传时间后再看。"
                  : "上传 PDF / Word / Markdown 后，系统会解析、切块并写入向量库。"
              }
            />
          }
          page={{ current: page.current, pageSize: page.pageSize, total }}
          onPageChange={onPageChange}
          selectable
          selectedKeys={selectedIds}
          onSelectionChange={setSelectedIds}
        />
      </section>

      <p className="admin-knowledge__footer num">
        列出的是全站知识文档（管理员视角）；普通用户只看到自己上传的
      </p>

      {/* 文档工作区：原文阅读 + 切片检查。详情请求与分栏布局都在组件内，
          页面只负责选中哪一份文档。 */}
      <KnowledgeWorkspace target={previewTarget} onClose={closePreview} />

      {/* 改名弹层 */}
      <Modal
        open={renameTarget != null}
        title="修改标题"
        onClose={closeRename}
        footer={
          <>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={closeRename}
              disabled={renaming}
            >
              取消
            </button>
            <button type="button" className="admin-btn admin-btn--primary" onClick={confirmRename} disabled={renaming}>
              {renaming ? "保存中…" : "保存"}
            </button>
          </>
        }
      >
        <div className="admin-form">
          <label className="admin-form__field">
            <span className="admin-form__label">标题 · TITLE</span>
            <input
              className="admin-users__input"
              value={renameTitle}
              onChange={(event) => setRenameTitle(event.target.value)}
              aria-label="标题"
            />
          </label>
          <p className="admin-form__hint">
            只改标题，不动文件本体；换文件请重新上传，旧的切片会被一并替换。
          </p>
          {renameError ? (
            <FaultNote
              className="admin-form__fault"
              fault={fault({
                severity: "attention",
                kind: "client",
                title: renameError.text,
                code: renameError.code,
              })}
            />
          ) : null}
        </div>
      </Modal>

      <Modal
        open={deleteTarget != null}
        title="删除知识文档"
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
          <p className="admin-knowledge__modal-text">
            确定删除文档{" "}
            <span className="admin-knowledge__modal-name">{deleteTarget.fileName}</span>{" "}
            吗？此操作不可撤销。
          </p>
        ) : null}
      </Modal>
    </div>
  )
}

export default AdminKnowledgePage
