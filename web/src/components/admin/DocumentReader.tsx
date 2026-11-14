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
 * PDF 探针结论与「已载入」标记同样按 id 隔离，旧文档的结论不会落到新文档上。
 */

type Loaded = { id: string; html?: string; text?: string; error?: string }

/**
 * PDF 探针结论，按文档 id 标记。
 *
 * <p>不带 id 的话，换文档时上一份的结论会留在新文档上：上一份探出「不是 PDF」
 * （比如会话过期），新文档就会被误判成「没拿到 PDF 内容（登录可能已过期）」。
 */
type PdfProbe = { id: string; state: "pdf" | "not-pdf" }

export function DocumentReader({ detail }: { detail: KnowledgeDetail }): ReactElement {
  const kind = documentRenderKind(detail.fileType)
  const id = detail.id
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [pdfLoadedId, setPdfLoadedId] = useState<string | null>(null)
  /** PDF 探针：iframe 的 onLoad 拿到什么内容都会触发，得先问服务端「这是 PDF 吗」。 */
  const [pdfProbe, setPdfProbe] = useState<PdfProbe | null>(null)
  /** 探针结论只认当前文档；换文档后上一份的结论立刻失效，回到「探测中」。 */
  const probeState = pdfProbe && pdfProbe.id === id ? pdfProbe.state : "checking"

  // 只探响应头（HEAD），不下载正文：确认拿到的真是 PDF 再让 iframe 显示，
  // 否则鉴权过期时 iframe 里会是一坨 JSON，角标却写着「浏览器内嵌查看器」。
  useEffect(() => {
    if (kind !== "pdf") return
    let cancelled = false
    const controller = new AbortController()
    // credentials 必须与全站其他请求一致（http.ts / adminApi 都是 "include"）：
    // 默认的 "same-origin" 在同源时带 cookie、跨源时就不带——后端把
    // VITE_API_BASE_URL 指到别的源时，探针会变成匿名请求，把「鉴权过期」
    // 误报成「服务端返回的不是 PDF」。
    fetch(knowledgeContentUrl(id), {
      method: "HEAD",
      credentials: "include",
      signal: controller.signal,
    })
      .then((response) => {
        const type = response.headers.get("content-type") ?? ""
        if (!cancelled) setPdfProbe({ id, state: type.includes("application/pdf") ? "pdf" : "not-pdf" })
      })
      .catch(() => {
        if (!cancelled) setPdfProbe({ id, state: "not-pdf" })
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [id, kind])

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
    const notPdf = probeState === "not-pdf"
    return (
      <div className="admin-doc__reader-inner">
        <div className="admin-doc__reader-tools num">
          <span className={`admin-doc__reader-chip${pdfLoaded && !notPdf ? "" : " is-loading"}`}>
            {notPdf ? (
              "没有拿到 PDF 内容（登录可能已过期）"
            ) : pdfLoaded ? (
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
        {notPdf ? (
          <p className="admin-doc__reader-note num">
            服务端返回的不是 PDF（多半是鉴权过期后的错误响应）。请重新登录，或用「下载原文件」核对。
          </p>
        ) : (
          <iframe
            // key 绑文档 id：换文档时重建 iframe。复用同一个元素的话，
            // 上一份文档的 load 事件会落在新文档的 onLoad 上，把还没载入的
            // 新文档标成「已载入」。
            key={id}
            className="admin-doc__pdf"
            src={openUrl}
            title={`${detail.fileName} 原文`}
            onLoad={() => setPdfLoadedId(id)}
          />
        )}
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
