import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactElement } from "react"

import { SectionHead } from "@/components/SectionHead"
import { DataTable, type Column } from "@/components/admin/DataTable"
import { Toolbar } from "@/components/admin/Toolbar"
import { Modal } from "@/components/admin/Modal"
import { RiskTag } from "@/components/RiskTag"
import { FaultNote } from "@/components/fault"
import {
  deleteKnowledge,
  listKnowledge,
  uploadKnowledge,
  type KnowledgeDoc,
  type Page,
} from "@/lib/adminApi"
import { describeError, type ErrorDetail } from "@/lib/api"
import { formatTimestamp, type Risk } from "@/lib/domain"
import { fault } from "@/lib/faults"

const DEFAULT_PAGE_SIZE = 10
const POLL_MS = 3000
const ACCEPT = ".pdf,.doc,.docx,.txt,.md,.markdown"

/** 加载 / 错误 / 数据三态同源；不在各事件里散着维护布尔量（对齐 AdminUsersPage）。 */
type View = { data: Page<KnowledgeDoc> | null; fault: ErrorDetail | null; loading: boolean }

/** 状态 → 风险档 + 文字。其他值走 .risk[data-risk="unknown"] 的 default 档。 */
function statusView(status: number): { label: string; risk: Risk } {
  switch (status) {
    case 0:
      return { label: "处理中", risk: "attention" }
    case 1:
      return { label: "已完成", risk: "normal" }
    case 2:
      return { label: "失败", risk: "critical" }
    default:
      return { label: "未知", risk: "unknown" }
  }
}

/** 文件大小 B / KB / MB 格式化函数（brief 逐字）。数值列统一 mono。 */
function formatFileSize(bytes?: number): string {
  if (!bytes || bytes < 0) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 知识库（真实端点：上传 / 轮询 / 删除）。
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
  const [page, setPage] = useState({ current: 1, pageSize: DEFAULT_PAGE_SIZE })
  const [view, setView] = useState<View>({ data: null, fault: null, loading: true })
  const requestSeq = useRef(0)

  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 「处理中」队列：仅放本次会话新上传、且服务端仍标记 status===0 的文件名
  // （Vue 版 processingFiles 语义）。轮询开关另用 hasProcessing 承接「列表存在
  // status===0」，两者同源（都取自加载结果），但不混为一个布尔量。
  const [processingNames, setProcessingNames] = useState<string[]>([])
  const [hasProcessing, setHasProcessing] = useState(false)
  // 轮询定时器句柄；防重入（已有 timer 不再起）+ 卸载清理都靠它。
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // 轮询单飞：上一次轮询还没回就不发下一次，避免慢响应把请求堆叠起来。
  const pollInFlightRef = useRef(false)

  const [deleteTarget, setDeleteTarget] = useState<KnowledgeDoc | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState<ErrorDetail | null>(null)

  /** 成功取数后的统一落盘：三态 + 处理中队列 + 轮询开关，全在 Promise 续体里。 */
  const applyLoaded = useCallback((seq: number, data: Page<KnowledgeDoc>) => {
    if (seq !== requestSeq.current) return
    const records = data.records ?? []
    const status0Names = new Set(
      records.filter((doc) => doc.status === 0).map((doc) => doc.fileName),
    )
    // Vue watch 语义：队列只保留服务端仍在处理的文件名；内容不变时沿用 prev，
    // 避免每 3 秒轮询都触发一次无谓重渲染。
    setProcessingNames((prev) => {
      const next = prev.filter((name) => status0Names.has(name))
      return next.length === prev.length ? prev : next
    })
    setHasProcessing(status0Names.size > 0)
    setView({ data, fault: null, loading: false })
  }, [])

  /** 失败：静默轮询不打断（保留上一帧数据与轮询开关，timer 继续），全量取数才报错。 */
  const applyFailed = useCallback((seq: number, cause: unknown, silent: boolean) => {
    if (seq !== requestSeq.current) return
    if (silent) return
    setView({ data: null, fault: describeError(cause), loading: false })
  }, [])

  /**
   * 纯发请求：不在此同步写任何 state，全部交给续体（合规 react-hooks/set-state-in-effect）。
   * 交互取数（首次挂载 / startLoad）递增 requestSeq 成为「最新权威请求」；静默轮询
   * 只读取当前序号、不递增——这样一次失败的静默轮询不会占住赢家序号、把仍在飞行的
   * 交互请求结果作废（背景拉取失败不该让页面卡在 loading）。轮询成功仅在没有更新的
   * 交互请求插队时才提交（applyLoaded 的 seq 比对），保证「最新数据胜出」。
   * 静默轮询另用 pollInFlightRef 单飞：上一次未回就跳过本次，避免慢响应堆叠、
   * 更晚发起的轮询被更早的响应覆盖。
   */
  const fireLoad = useCallback(
    (current: number, pageSize: number, silent: boolean) => {
      if (silent && pollInFlightRef.current) return
      if (silent) pollInFlightRef.current = true
      const seq = silent ? requestSeq.current : ++requestSeq.current
      const settle = () => {
        if (silent) pollInFlightRef.current = false
      }
      listKnowledge(current, pageSize).then(
        (data) => {
          settle()
          applyLoaded(seq, data)
        },
        (cause) => {
          settle()
          applyFailed(seq, cause, silent)
        },
      )
    },
    [applyLoaded, applyFailed],
  )

  // 首次挂载加载一次：初始 view 已是 loading=true，effect 里只发请求、不写 state。
  useEffect(() => {
    fireLoad(1, DEFAULT_PAGE_SIZE, false)
  }, [fireLoad])

  /**
   * 轮询：列表存在 status===0 时 3 秒 setInterval 重拉；无则停；卸载清定时器；
   * 防重入（已有 timer 不再起）。轮询用 silent 刷新——不置 loading、不清空 data，
   * 因此 hasProcessing 在轮询期间保持稳定 true，单个 timer 不会被反复重挂。
   */
  useEffect(() => {
    if (!hasProcessing) return
    if (pollTimerRef.current !== null) return
    pollTimerRef.current = setInterval(() => {
      fireLoad(page.current, page.pageSize, true)
    }, POLL_MS)
    return () => {
      if (pollTimerRef.current !== null) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
      // 定时器停了就把单飞标记复位，避免下次重新起轮询时被上一次的残留挡住。
      pollInFlightRef.current = false
    }
  }, [hasProcessing, page, fireLoad])

  /** 事件驱动的全量刷新：在事件里同步置 loading，再发请求（effect 只负责首次挂载）。 */
  function startLoad(current: number, pageSize: number) {
    setView({ data: null, fault: null, loading: true })
    fireLoad(current, pageSize, false)
  }

  function onPageChange(next: { current: number; pageSize: number }) {
    // pageSize 变化一律回第 1 页（DataTable 已传 current:1，这里再钉死一次）。
    const nextPage =
      next.pageSize !== page.pageSize
        ? { current: 1, pageSize: next.pageSize }
        : { current: next.current, pageSize: next.pageSize }
    setPage(nextPage)
    startLoad(nextPage.current, nextPage.pageSize)
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
      // 新上传文件进「处理中」队列：页内处理中条立即显示文件名。
      setProcessingNames((prev) => {
        const next = new Set(prev)
        files.forEach((file) => next.add(file.name))
        return [...next]
      })
      setHasProcessing(true) // 立即起轮询（随后的列表刷新会再按服务端状态确认）
      startLoad(page.current, page.pageSize) // 刷新列表
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
      await deleteKnowledge(target.id) // 本页 id 是 number 普通自增，直接传，不转雪花 string
      setDeleteTarget(null)
      startLoad(page.current, page.pageSize) // 成功后刷新当前页
    } catch (cause) {
      setDeleteTarget(null) // 收起弹层，让页内提示露出来
      setActionError(describeError(cause))
    } finally {
      setDeleting(false)
    }
  }

  const columns: Column<KnowledgeDoc>[] = [
    { key: "fileName", title: "文件名" },
    {
      key: "fileType",
      title: "类型",
      width: "92px",
      render: (row) => (row.fileType ? row.fileType.toUpperCase() : "—"),
    },
    {
      key: "fileSize",
      title: "大小",
      width: "108px",
      mono: true,
      render: (row) => formatFileSize(row.fileSize),
    },
    { key: "chunkCount", title: "分块数", width: "88px", mono: true },
    {
      key: "status",
      title: "状态",
      width: "112px",
      render: (row) => {
        const v = statusView(row.status)
        return <RiskTag risk={v.risk}>{v.label}</RiskTag>
      },
    },
    {
      key: "createTime",
      title: "上传时间",
      width: "158px",
      mono: true,
      render: (row) => formatTimestamp(row.createTime),
    },
    {
      key: "action",
      title: "操作",
      width: "92px",
      render: (row) => (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => openDelete(row)}
        >
          删除
        </button>
      ),
    },
  ]

  // 三态同源：loading / error / 数据都从 view 读；加载与出错时 rows 都是 undefined。
  const rows = view.data?.records
  const total = view.data?.total ?? 0

  return (
    <div className="admin-knowledge">
      <div className="admin-knowledge__head">
        <SectionHead code="05" kicker="知识库" en="ADMIN · KNOWLEDGE" />
      </div>

      <Toolbar>
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
            className="btn btn--ghost btn--sm"
            onClick={() => fileInputRef.current?.click()}
          >
            选择文件
          </button>
          <span className="admin-knowledge__hint num">PDF / DOC / DOCX / TXT / MD · 可多选</span>
          <div className="admin-knowledge__upload-actions">
            <button
              type="button"
              className="btn btn--sm"
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
      </Toolbar>

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

      <section className="admin-knowledge__table" aria-label="知识文档列表">
        <DataTable<KnowledgeDoc>
          columns={columns}
          rows={rows}
          rowKey={(row) => String(row.id)}
          loading={view.loading}
          error={view.fault?.text ?? null}
          emptyText="暂无文档"
          page={{ current: page.current, pageSize: page.pageSize, total }}
          onPageChange={onPageChange}
        />
      </section>

      <p className="admin-knowledge__footer num">
        列出的是你名下上传的知识文档（后端数据边界，见设计文档 §7）
      </p>

      <Modal
        open={deleteTarget != null}
        title="删除知识文档"
        onClose={closeDelete}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={closeDelete}
              disabled={deleting}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn--sm"
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
