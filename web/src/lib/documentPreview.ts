/**
 * 文档原文渲染：管理端阅读器「原文 / 切片」双栏共用这一层。
 *
 * <p>三类来源，两条安全线：
 * - pdf：COS 签名 URL 交给浏览器自带的 PDF 查看器（iframe），本站不解析 PDF；
 * - text：后端直读的纯文本，按 `<pre>` 原样呈现，Markdown 记号不二次渲染——
 *   原文是什么管理员就该看到什么，渲染反而会改掉换行与记号；
 * - md / markdown / docx：渲染成 HTML。Markdown 走全站同一条
 *   `renderNewsHtml`（markdown-it + DOMPurify 白名单）；DOCX 由 mammoth 在浏览器
 *   内转成 HTML 后，再过同一个 `sanitizeNewsHtml`——两条来源的净化口径一致，
 *   上传文档里塞 `<script>` 也到不了 DOM。
 */

import { renderNewsHtml } from "./markdown"
import { sanitizeNewsHtml } from "./sanitize"

/** 前端按文件类型选渲染器：md / markdown 走 Markdown 管线，docx 走 mammoth。 */
const MARKDOWN_TYPES = new Set(["md", "markdown"])
const DOCX_TYPES = new Set(["docx"])

export type DocumentRenderKind = "pdf" | "text" | "docx" | "markdown" | "none"

export function documentRenderKind(fileType?: string | null): DocumentRenderKind {
  const type = (fileType ?? "").toLowerCase()
  if (type === "pdf") return "pdf"
  if (DOCX_TYPES.has(type)) return "docx"
  if (MARKDOWN_TYPES.has(type)) return "markdown"
  if (type === "txt") return "text"
  return "none"
}

/**
 * DOCX → 白名单 HTML。mammoth 只输出它自己的一组标签，净化兜底防版本漂移。
 *
 * <p>mammoth 按需动态加载：只有真的打开 DOCX 才下载它（约 100KB gzip），
 * 知识库页本身不为一个格式背上整个转换器的体积。
 */
export async function renderDocxHtml(arrayBuffer: ArrayBuffer): Promise<string> {
  const { convertToHtml } = await import("mammoth")
  // 浏览器构建读 options.arrayBuffer（见 mammoth/browser/unzip.js）。
  const result = await convertToHtml({ arrayBuffer })
  return sanitizeNewsHtml(result.value)
}

/** Markdown 源 → 白名单 HTML，与公开资讯页同一条管线。 */
export function renderMarkdownDocument(source: string): string {
  return renderNewsHtml(source)
}
