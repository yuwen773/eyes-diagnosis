import MarkdownIt from "markdown-it"
import hljs from "highlight.js/lib/core"
import bash from "highlight.js/lib/languages/bash"
import c from "highlight.js/lib/languages/c"
import cpp from "highlight.js/lib/languages/cpp"
import css from "highlight.js/lib/languages/css"
import go from "highlight.js/lib/languages/go"
import java from "highlight.js/lib/languages/java"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import markdown from "highlight.js/lib/languages/markdown"
import php from "highlight.js/lib/languages/php"
import python from "highlight.js/lib/languages/python"
import rust from "highlight.js/lib/languages/rust"
import sql from "highlight.js/lib/languages/sql"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"
import yaml from "highlight.js/lib/languages/yaml"
import { sanitizeAgentHtml, sanitizeNewsHtml } from "./sanitize"

/**
 * 只注册眼科 Agent 与资讯里真正会出现的语言。
 * 整包 highlight.js 会把 markdown 块撑到 1MB；按需注册后约降到六分之一，
 * 未注册的语言仍走「普通代码块」分支，不会报错。
 */
const LANGUAGES = {
  bash, c, cpp, css, go, java, javascript, json, markdown, php, python, rust, sql,
  typescript, xml, yaml,
}
for (const [name, definition] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, definition)
}

// 图表代码块语言列表
export const DIAGRAM_LANGUAGES = ["mermaid", "drawio", "plantuml"]

/**
 * 流式尾段里还有未闭合的代码围栏时，暂时只做转义、不做语法高亮：
 * 每 60ms 对一段不断变长的代码跑一遍 hljs 是纯开销，而且结果下一片就作废。
 * 围栏闭合后它进入稳定段，那时才高亮一次。
 */
let suppressHighlight = false

function plainCodeBlock(str: string, lang: string): string {
  return (
    '<pre class="hljs code-block"><div class="code-header"><span class="code-lang">' +
    lang +
    '</span><button class="copy-btn" data-code>复制</button></div><code>' +
    md.utils.escapeHtml(str) +
    "</code></pre>"
  )
}

// 创建 markdown-it 实例，启用 GFM
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight: function (str: string, lang: string): string {
    // 图表语言不做语法高亮，保持原始内容供前端渲染
    if (lang && DIAGRAM_LANGUAGES.includes(lang.toLowerCase())) {
      return `<pre class="hljs code-block diagram-block" data-lang="${lang}"><div class="code-header"><span class="code-lang">${lang}</span><button class="copy-btn" data-code>复制</button></div><code>${md.utils.escapeHtml(str)}</code></pre>`
    }

    if (suppressHighlight) {
      return plainCodeBlock(str, lang || "code")
    }

    // 如果有语言标识，使用 highlight.js 高亮
    if (lang && hljs.getLanguage(lang)) {
      try {
        return (
          '<pre class="hljs code-block"><div class="code-header"><span class="code-lang">' +
          lang +
          '</span><button class="copy-btn" data-code>复制</button></div><code>' +
          hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
          "</code></pre>"
        )
      } catch (e) {
        void e
      }
    }
    // 否则返回普通代码块
    return plainCodeBlock(str, "code")
  },
})

/* ── 证据引用 ────────────────────────────────────────────── */

/**
 * 正文里的证据引用：`[[<documentId>#<chunkIndex>]]`。
 *
 * <p>键由检索工具真实产出（工具输出里写着 `(证据: id#n)`），模型只负责把它
 * 标在支持该句的位置。**能不能核验由前端判定**：键出现在本回合的资源里才
 * 算数，否则显示「未核验」——不把模型写出来的任何编号直接当成依据。
 */
export type EvidenceCitation = { key: string; title?: string }

/** 一段正文可引用的证据：顺序即正文角标编号（从 1 开始）。 */
export type CitationContext = { citations: readonly EvidenceCitation[] }

/** 证据键的字面形状；含空白或标点的标记不当作引用，按原文保留。 */
const CITE_KEY_RE = /^([A-Za-z0-9_.:-]+)#(\d+)$/
/** 标记自身的长度上限：挡住正文里意外出现的长 `[[...]]`。 */
const CITE_MARKER_MAX = 120

/** 当前这次渲染的引用上下文。渲染是同步的，用模块变量传进 inline 规则。 */
let citationNumbers: Map<string, EvidenceCitation & { n: number }> | null = null

md.inline.ruler.before("link", "evidence_citation", (state, silent) => {
  const numbers = citationNumbers
  if (!numbers) return false
  const src = state.src
  const start = state.pos
  if (src.charCodeAt(start) !== 0x5b || src.charCodeAt(start + 1) !== 0x5b) return false
  const end = src.indexOf("]]", start + 2)
  if (end < 0) return false
  const raw = src.slice(start + 2, end)
  if (raw.length === 0 || raw.length > CITE_MARKER_MAX) return false
  const match = CITE_KEY_RE.exec(raw)
  if (!match) return false
  if (silent) return true

  const token = state.push("html_inline", "", 0)
  const known = numbers.get(`${match[1]}#${match[2]}`)
  if (known) {
    token.content =
      `<button type="button" class="cite" data-cite-key="${md.utils.escapeHtml(known.key)}"` +
      ` aria-label="依据 ${known.n}${known.title ? `：${md.utils.escapeHtml(known.title)}` : ""}">` +
      `${known.n}</button>`
  } else {
    // 医学正文里不能把无法核验的引用悄悄抹掉：读者要看得见这一句没有依据。
    token.content =
      '<span class="cite is-unverified" title="这条引用不在本回合的检索结果里，无法核验">未核验</span>'
  }
  state.pos = end + 2
  return true
})

/**
 * 渲染计量：只统计真正跑过的 markdown-it 解析次数与字符量。
 * 流式性能验证靠它给出确定性数字（渲染次数、处理的字符总量），
 * 不依赖机器快慢，也不靠截图估计。
 */
const renderStats = { renders: 0, chars: 0 }

export function getMarkdownRenderStats(): { renders: number; chars: number } {
  return { ...renderStats }
}

export function resetMarkdownRenderStats(): void {
  renderStats.renders = 0
  renderStats.chars = 0
}

/** 未净化的原始渲染。`ctx` 为空时不识别证据标记，正文按原文显示。 */
function renderRaw(content: string, ctx?: CitationContext | null): string {
  renderStats.renders += 1
  renderStats.chars += content.length
  const previous = citationNumbers
  citationNumbers = ctx
    ? new Map(ctx.citations.map((citation, index) => [citation.key, { ...citation, n: index + 1 }]))
    : null
  try {
    return md.render(content)
  } finally {
    citationNumbers = previous
  }
}

/**
 * 渲染并净化（Agent 正文）。
 *
 * <p>`ctx` 只在助手正文里传：它决定哪些 `[[证据键]]` 能核验、编号是几。
 * 推理块、资讯等没有资源上下文的正文不传，标记按原文保留。
 */
export function renderMarkdown(content: string, ctx?: CitationContext | null): string {
  if (!content) return ""
  return sanitizeAgentHtml(renderRaw(content, ctx))
}

/* ── 流式增量渲染 ────────────────────────────────────────────── */

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s+/
const BLOCKQUOTE = /^\s{0,3}>/
const TABLE_ROW = /^\s{0,3}\|/
const INDENTED = /^(?: {4}|\t)/
const SETEXT_UNDERLINE = /^\s{0,3}(?:=+|-+)\s*$/
/** 引用式链接定义是全文作用域，分段渲染会丢引用：出现时退回整篇渲染。 */
const REFERENCE_DEFINITION = /^\s{0,3}\[[^\]]+\]:\s+\S/m

/**
 * 向上取整到「段与段之间的空行」：返回可安全切分的长度。
 *
 * <p>只在顶层空行处切，且要求空行前后都不是列表/缩进/表格/标题下划线
 * 这类会跨空行延续的结构。切点之前的 Markdown 不会再被后续 token 改写，
 * 可以只渲染一次并缓存。
 */
export function stableBoundary(text: string, from = 0): number {
  let lastSafe = from
  let fence: { char: string; len: number } | null = null
  let prevNonBlank = ""
  let index = 0

  while (index < text.length) {
    const newline = text.indexOf("\n", index)
    const lineEnd = newline === -1 ? text.length : newline
    const raw = text.slice(index, lineEnd)
    const trimmed = raw.trim()
    const fenceMatch = FENCE.exec(raw)

    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.len) {
        fence = null
      }
    } else if (fenceMatch) {
      fence = { char: fenceMatch[1][0], len: fenceMatch[1].length }
    }

    if (!fence) {
      if (trimmed === "") {
        // 向后找下一行非空内容，判断这个空行是不是真正的分块边界。
        let lookahead = newline === -1 ? text.length : newline + 1
        let nextNonBlank = ""
        let nextIndented = false
        while (lookahead < text.length) {
          const nextNewline = text.indexOf("\n", lookahead)
          const nextEnd = nextNewline === -1 ? text.length : nextNewline
          const nextRaw = text.slice(lookahead, nextEnd)
          if (nextRaw.trim() !== "") {
            nextNonBlank = nextRaw
            nextIndented = INDENTED.test(nextRaw)
            break
          }
          lookahead = nextNewline === -1 ? text.length : nextNewline + 1
        }

        const prevIsList = LIST_ITEM.test(prevNonBlank)
        const prevIsIndented = INDENTED.test(prevNonBlank)
        const nextIsList = LIST_ITEM.test(nextNonBlank)
        const nextIsQuote = BLOCKQUOTE.test(nextNonBlank)
        const nextIsTable = TABLE_ROW.test(nextNonBlank)
        const nextIsSetext = SETEXT_UNDERLINE.test(nextNonBlank)

        const safe =
          nextNonBlank !== "" &&
          !prevIsList &&
          !prevIsIndented &&
          !nextIsList &&
          !nextIndented &&
          !nextIsQuote &&
          !nextIsTable &&
          !nextIsSetext

        if (safe) {
          lastSafe = Math.min(text.length, lineEnd + 1)
        }
      } else {
        prevNonBlank = raw
      }
    }

    if (newline === -1) break
    index = newline + 1
  }

  return lastSafe
}

/** 尾段是否还有未闭合的代码围栏（决定要不要跳过语法高亮）。 */
function hasOpenFence(text: string): boolean {
  let open: { char: string; len: number } | null = null
  let index = 0
  while (index < text.length) {
    const newline = text.indexOf("\n", index)
    const lineEnd = newline === -1 ? text.length : newline
    const match = FENCE.exec(text.slice(index, lineEnd))
    if (open) {
      if (match && match[1][0] === open.char && match[1].length >= open.len) open = null
    } else if (match) {
      open = { char: match[1][0], len: match[1].length }
    }
    if (newline === -1) break
    index = newline + 1
  }
  return open !== null
}

/** 给未闭合的围栏补一个临时闭合符，让代码块立刻成形，而不是先变成段落。 */
function closeUnclosedFences(text: string): string {
  let open: { char: string; len: number } | null = null
  let index = 0
  while (index < text.length) {
    const newline = text.indexOf("\n", index)
    const lineEnd = newline === -1 ? text.length : newline
    const match = FENCE.exec(text.slice(index, lineEnd))
    if (open) {
      if (match && match[1][0] === open.char && match[1].length >= open.len) open = null
    } else if (match) {
      open = { char: match[1][0], len: match[1].length }
    }
    if (newline === -1) break
    index = newline + 1
  }
  if (!open) return text
  const closing = open.char.repeat(open.len)
  return text.endsWith("\n") ? `${text}${closing}\n` : `${text}\n${closing}\n`
}

/**
 * 单个消息的增量渲染器。
 *
 * <p>稳定段只渲染一次并缓存；每次只重渲尾部。整篇成本从 O(n²) 降到
 * 大致线性（尾段受分块边界约束）。流结束时用整篇渲染收口一次，
 * 消除分段边界可能造成的一点点结构差异。
 */
export function createIncrementalMarkdownRenderer() {
  let stableSource = ""
  let stableHtml = ""
  let lastFinalSource: string | null = null
  let lastFinalHtml = ""
  /**
   * 引用上下文的签名。稳定段缓存里已经写死了角标编号与「可核验」判定，
   * 上下文一变（资源晚到/换了回合）就必须整篇重来，否则旧段落停在旧判定上。
   */
  let stableCitationSignature: string | null = null

  function reset() {
    stableSource = ""
    stableHtml = ""
    lastFinalSource = null
    lastFinalHtml = ""
    stableCitationSignature = null
  }

  return {
    reset,
    render(content: string, streaming: boolean, ctx?: CitationContext | null): string {
      if (!content) {
        reset()
        return ""
      }

      // 区分「不识别引用」与「识别，但这一回合没有可核验来源」：两者签名不能相同。
      const signature = ctx
        ? `ctx:${ctx.citations.map((citation) => citation.key).join("\u0000")}`
        : "none"
      if (stableCitationSignature !== null && stableCitationSignature !== signature) {
        // 上下文变了：缓存段作废，但已渲染内容仍可作为下一次的起点。
        stableSource = ""
        stableHtml = ""
        lastFinalSource = null
      }
      stableCitationSignature = signature

      if (!streaming) {
        if (lastFinalSource === content) return lastFinalHtml
        const html = renderMarkdown(content, ctx)
        lastFinalSource = content
        lastFinalHtml = html
        stableSource = content
        stableHtml = html
        return html
      }

      // 引用式链接定义是全文作用域，分段会丢引用——整篇渲染。
      if (REFERENCE_DEFINITION.test(content)) {
        stableSource = content
        stableHtml = renderMarkdown(content, ctx)
        return stableHtml
      }

      // 内容不再以已缓存前缀开头（重新生成/替换）：从头来过。
      if (!content.startsWith(stableSource)) {
        stableSource = ""
        stableHtml = ""
      }

      const cut = stableBoundary(content, stableSource.length)
      if (cut > stableSource.length) {
        const segment = content.slice(stableSource.length, cut)
        stableHtml += sanitizeAgentHtml(renderRaw(segment, ctx))
        stableSource = content.slice(0, cut)
      }

      const tail = content.slice(stableSource.length)
      const openFence = hasOpenFence(tail)
      suppressHighlight = openFence
      let tailHtml: string
      try {
        tailHtml = sanitizeAgentHtml(renderRaw(closeUnclosedFences(tail), ctx))
      } finally {
        suppressHighlight = false
      }
      return stableHtml + tailHtml
    },
  }
}

/**
 * 资讯用的渲染器：不做语法高亮与「复制」按钮那套仪器外壳——
 * 公开页的净化白名单里没有 button，正文里留下一个死按钮比没有更糟。
 * 结构（标题、代码块、表格）与正文一致，净化后仍然成立。
 */
const mdNews = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
})

/**
 * 资讯正文：编辑页预览、落库内容、公开页显示走同一条管线。
 * 公开页还会再净化一次（后端存的也可能是旧 HTML），净化是幂等的。
 *
 * <p>allowRemoteImages=false 用于上传文档这类外部来源：正文里的远程图片
 * 会把读者的浏览器引到第三方。资讯正文是编辑部自己写的，默认放行。
 */
export function renderNewsHtml(content: string, options?: { allowRemoteImages?: boolean }): string {
  if (!content) return ""
  return sanitizeNewsHtml(mdNews.render(content), options)
}
