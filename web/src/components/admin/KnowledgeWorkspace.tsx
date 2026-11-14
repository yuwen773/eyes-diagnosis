import { useState, type ReactElement } from "react"
import { useQuery } from "@tanstack/react-query"
import { FileDown, FileText } from "lucide-react"

import { Drawer } from "@/components/admin/Drawer"
import { RiskTag } from "@/components/RiskTag"
import { FaultNote } from "@/components/fault"
import { ChunkInspector } from "@/components/admin/ChunkInspector"
import { DocumentReader } from "@/components/admin/DocumentReader"
import { X } from "lucide-react"

import {
  getKnowledgeDetail,
  knowledgeContentUrl,
  type KnowledgeDetail,
  type KnowledgeDoc,
} from "@/lib/adminApi"
import { knowledgeStatusView } from "@/lib/adminDomain"
import { describeError } from "@/lib/api"
import { queryKeys } from "@/lib/queryKeys"
import { formatTimestamp } from "@/lib/domain"
import { fault } from "@/lib/faults"
import { useMediaQuery } from "@/lib/useMediaQuery"

/**
 * 头部切片读数跟随「看到的清单」而不是库里的计数：详情接口返回的是按
 * 当前规则重放的切片，入库计数（chunkCount）是入库那一刻的规则算出来的，
 * 两者可能不等（切分参数改过就会差）。同一块屏幕上只能有一个数，
 * 差异在切片栏的摘要里如实说明。
 */
function chunkSummary(detail: KnowledgeDetail): string {
  if (detail.status === 0) return "切片处理中"
  if (detail.chunksReadable === false) return "切片不可读"
  const count = detail.chunks?.length ?? 0
  if (detail.status !== 1) return `${count} 块 · 未入库`
  // 入库计数与当前规则重放不一致时，头部必须带口径，不能让人以为索引里只有这些。
  const stored = detail.chunkCount ?? 0
  return stored === count ? `${count} 块切片` : `${count} 块 · 当前规则重放`
}

/** 与管理端其它台账一致的字节格式化（列表与详情用同一口径）。 */
function formatFileSize(bytes?: string | number): string {
  const size = Number(bytes)
  if (!size || size < 0 || !Number.isFinite(size)) return "—"
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 文档工作区：原文阅读 + RAG 切片检查。
 *
 * <p>桌面端左右分栏（原文宽、切片窄），两栏各自滚动；窄屏切换成「原文 / 切片」
 * 两个页签，避免把两块内容挤进 390px。抽屉本身复用 Base UI Dialog 的焦点与
 * 滚动锁，不另造一套弹层。
 */
export function KnowledgeWorkspace(props: {
  target: KnowledgeDoc | null
  onClose: () => void
}): ReactElement {
  const { target, onClose } = props
  const detailQuery = useQuery({
    queryKey: queryKeys.admin.knowledgeDetail(target?.id ?? ""),
    queryFn: () => getKnowledgeDetail(target!.id),
    enabled: target !== null,
  })
  const detail = target ? detailQuery.data : undefined
  const loading = target !== null && detailQuery.isPending
  const faultInfo = detailQuery.error ? describeError(detailQuery.error) : null

  const narrow = useMediaQuery("(max-width: 900px)")
  const [pane, setPane] = useState<"reader" | "chunks">("reader")

  const statusView = knowledgeStatusView(detail?.status ?? target?.status)
  const downloadUrl = target ? knowledgeContentUrl(target.id, true) : "#"

  return (
    <Drawer
      open={target !== null}
      title={target?.fileName || "文档预览"}
      onClose={onClose}
      size="workspace"
      headless
    >
      {loading ? (
        <p className="admin-doc__state">正在读取文档…</p>
      ) : faultInfo ? (
        <FaultNote
          className="admin-doc__fault"
          fault={fault({
            severity: "attention",
            kind: "client",
            title: faultInfo.text,
            code: faultInfo.code,
          })}
        />
      ) : detail ? (
        <div className="admin-doc">
          <header className="admin-doc__head">
            <div className="admin-doc__head-main">
              <span className="admin-doc__head-icon" aria-hidden="true">
                <FileText size={18} strokeWidth={1.8} />
              </span>
              <div className="admin-doc__head-text">
                <h3 className="admin-doc__name">{detail.fileName || "未命名文件"}</h3>
                <p className="admin-doc__meta num">
                  <span>{detail.fileType?.toUpperCase() || "—"}</span>
                  <span>{formatFileSize(detail.fileSize)}</span>
                  <span>{chunkSummary(detail)}</span>
                  <span>{formatTimestamp(detail.createTime)}</span>
                </p>
              </div>
            </div>
            <div className="admin-doc__head-side">
              <RiskTag risk={statusView.risk}>{statusView.label}</RiskTag>
              <a className="admin-btn admin-btn--ghost admin-btn--sm" href={downloadUrl}>
                <FileDown size={13} strokeWidth={2} aria-hidden="true" />
                下载原文件
              </a>
              <button
                type="button"
                className="admin-doc__close"
                aria-label="关闭文档工作区"
                onClick={onClose}
              >
                <X size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </header>

          {narrow ? (
            <div className="admin-doc__tabs" role="tablist" aria-label="文档视图">
              <button
                type="button"
                role="tab"
                aria-selected={pane === "reader"}
                className="admin-doc__tab num"
                onClick={() => setPane("reader")}
              >
                原文
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={pane === "chunks"}
                className="admin-doc__tab num"
                onClick={() => setPane("chunks")}
              >
                切片 · {detail.chunks?.length ?? 0}
              </button>
            </div>
          ) : null}

          <div className={`admin-doc__panes${narrow ? " is-narrow" : ""}`}>
            {!narrow || pane === "reader" ? (
              <section className="admin-doc__pane admin-doc__pane--reader" aria-label="原文阅读">
                <div className="admin-doc__pane-head">
                  <h4 className="admin-doc__pane-title">原文 · DOCUMENT</h4>
                  <span className="admin-doc__pane-note num">
                    {detail.previewKind === "pdf" ? "内嵌查看" : "只读"}
                  </span>
                </div>
                <div className="admin-doc__pane-body">
                  <DocumentReader detail={detail} />
                </div>
              </section>
            ) : null}

            {!narrow || pane === "chunks" ? (
              <section className="admin-doc__pane admin-doc__pane--chunks" aria-label="RAG 切片">
                <div className="admin-doc__pane-head">
                  <h4 className="admin-doc__pane-title">RAG 切片 · CHUNKS</h4>
                  <span className="admin-doc__pane-note num">
                    {detail.chunksReadable === false
                      ? "不可读"
                      : detail.status === 1
                        ? `${detail.chunks?.length ?? 0} 块`
                        : `${detail.chunks?.length ?? 0} 块 · 未入库`}
                  </span>
                </div>
                <div className="admin-doc__pane-body">
                  {/* key 让换文档时分页 / 折叠 / 复制回执整体重挂，不必手写重置 effect。 */}
                  <ChunkInspector key={detail.id} detail={detail} />
                </div>
              </section>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="admin-doc__state">暂无详情</p>
      )}
    </Drawer>
  )
}
