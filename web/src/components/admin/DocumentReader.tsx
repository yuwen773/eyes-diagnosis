import { useEffect, useState, type ReactElement } from "react"
import { ExternalLink, FileDown, LoaderCircle } from "lucide-react"

import { FaultNote } from "@/components/fault"
import {
  fetchKnowledgeDocx,
  fetchKnowledgeText,
  knowledgeContentUrl,
  type KnowledgeDetail,
} from "@/lib/adminApi"
import { ApiError, describeError } from "@/lib/api"
import { documentRenderKind, renderDocxHtml, renderMarkdownDocument } from "@/lib/documentPreview"
import { fault } from "@/lib/faults"

/**
 * 原文阅读区。
 *
 * <p>按真实文件类型分四支：PDF 交给浏览器查看器；Markdown 走全站渲染管线；
 * TXT 原样保留换行；DOCX 在浏览器内用 mammoth 转 HTML 后再净化。
 * DOC 是二进制旧格式，浏览器无法可靠解析，明确告知并引导下载——不冒充 DOCX。
 *
 * <p>取原文字节走同源代理端点（带会话鉴权），从不接触 COS 签名直链：
 * 链接不会过期，也不会把私有桶的凭据留在页面里。
 *
 * <p>读取结果按文档 id 标记：换一份文档时旧结果自动失效、显示「正在读取」，
 * 不需要在 effect 体内同步 setState（react-hooks/set-state-in-effect）。
 */

type Loaded = { id: string; html?: string; text?: string; error?: string }

export function DocumentReader({ detail }: { detail: KnowledgeDetail }): ReactElement {
  const kind = documentRenderKind(detail.fileType)
  const id = detail.id
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [pdfLoadedId, setPdfLoadedId] = useState<string | null>(null)

  useEffect(() => {
    if (kind !== "docx" && kind !== "markdown" && kind !== "text") return
    const controller = new AbortController()
    let cancelled = false

    async function load(): Promise<void> {
      try {
        if (kind === "docx") {
          const bytes = await fetchKnowledgeDocx(id, controller.signal)
          const html = await renderDocxHtml(bytes)
          if (!cancelled) setLoaded({ id, html })
          return
        }
        const source = await fetchKnowledgeText(id, controller.signal)
        if (cancelled) return
        setLoaded(
          kind === "markdown"
            ? { id, html: renderMarkdownDocument(source) }
            : { id, text: source },
        )
      } catch (cause) {
        // 卸载 / 切换文档导致的 abort 不是错误，交给下一轮状态。
        if (cancelled || controller.signal.aborted) return
        // 解析失败不是传输失败：mammoth 抛的是文件本身的问题，要说清楚。
        setLoaded({
          id,
          error:
            kind === "docx" && !(cause instanceof ApiError)
              ? "这份 DOCX 解析失败，文件可能已损坏或不是有效的 Word 文档。"
              : describeError(cause).text,
        })
      }
    }

    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [id, kind])

  const downloadUrl = knowledgeContentUrl(id, true)
  const openUrl = knowledgeContentUrl(id)

  if (kind === "pdf") {
    const pdfLoaded = pdfLoadedId === id
    return (
      <div className="admin-doc__reader-inner">
        <div className="admin-doc__reader-tools num">
          <span className={`admin-doc__reader-chip${pdfLoaded ? "" : " is-loading"}`}>
            {pdfLoaded ? (
              `${detail.fileName} · 浏览器内嵌查看器`
            ) : (
              <>
                <LoaderCircle size={12} strokeWidth={2} className="admin-doc__spin" aria-hidden="true" />
                PDF 载入中…
              </>
            )}
          </span>
          <a className="admin-doc__tools-link" href={openUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
            新窗口打开
          </a>
        </div>
        <iframe
          className="admin-doc__pdf"
          src={openUrl}
          title={`${detail.fileName} 原文`}
          onLoad={() => setPdfLoadedId(id)}
        />
        <p className="admin-doc__reader-note num">
          浏览器没有内置 PDF 查看器时这里会是空白——用「新窗口打开」或下载后查看。
        </p>
      </div>
    )
  }

  if (kind === "none") {
    const extension = (detail.fileType || "未知").toUpperCase()
    return (
      <div className="admin-doc__unsupported">
        <p className="admin-doc__unsupported-title">暂不支持在线预览 {extension}</p>
        <p className="admin-doc__unsupported-body">
          {extension === "DOC"
            ? "DOC 是旧版二进制 Word 格式，浏览器无法可靠还原其版式。请下载原文件查看；右侧会显示切片读取结果。"
            : "该格式没有可用的浏览器内渲染器。请下载原文件查看；右侧会显示切片读取结果。"}
        </p>
        <a className="admin-btn admin-btn--ghost" href={downloadUrl}>
          <FileDown size={14} strokeWidth={2} aria-hidden="true" />
          下载原文件
        </a>
      </div>
    )
  }

  const current = loaded && loaded.id === id ? loaded : null

  if (!current) {
    return (
      <p className="admin-doc__reader-state num">
        <LoaderCircle size={13} strokeWidth={2} className="admin-doc__spin" aria-hidden="true" />
        正在读取原文…
      </p>
    )
  }

  if (current.error) {
    return (
      <FaultNote
        className="admin-doc__reader-fault"
        fault={fault({
          severity: "attention",
          kind: "client",
          title: current.error,
        })}
      />
    )
  }

  if (current.text !== undefined) {
    return (
      <div className="admin-doc__reader-inner">
        <div className="admin-doc__reader-tools num">
          <span className="admin-doc__reader-chip">TXT · 纯文本原文</span>
        </div>
        <pre className="admin-doc__text">{current.text}</pre>
      </div>
    )
  }

  return (
    <div className="admin-doc__reader-inner">
      <div className="admin-doc__reader-tools num">
        <span className="admin-doc__reader-chip">
          {kind === "docx" ? "DOCX · 浏览器内解析" : "Markdown · 富文本"}
        </span>
      </div>
      {/* 两种来源都已过 sanitizeNewsHtml 白名单，与公开资讯正文同一条注入路径。 */}
      <div
        className={`admin-doc__prose${kind === "docx" ? " admin-doc__prose--docx" : ""}`}
        dangerouslySetInnerHTML={{ __html: current.html ?? "" }}
      />
    </div>
  )
}
