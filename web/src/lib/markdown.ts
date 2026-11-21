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

/** 未净化的原始渲染。 */
function renderRaw(content: string): string {
  renderStats.renders += 1
  renderStats.chars += content.length
  return md.render(content)
}

/** 渲染并净化（Agent 正文）。 */
export function renderMarkdown(content: string): string {
  if (!content) return ""
  return sanitizeAgentHtml(renderRaw(content))
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

  function reset() {
    stableSource = ""
    stableHtml = ""
    lastFinalSource = null
    lastFinalHtml = ""
  }

  return {
    reset,
    render(content: string, streaming: boolean): string {
      if (!content) {
        reset()
        return ""
      }

      if (!streaming) {
        if (lastFinalSource === content) return lastFinalHtml
        const html = renderMarkdown(content)
        lastFinalSource = content
        lastFinalHtml = html
        stableSource = content
        stableHtml = html
        return html
      }

      // 引用式链接定义是全文作用域，分段会丢引用——整篇渲染。
      if (REFERENCE_DEFINITION.test(content)) {
        stableSource = content
        stableHtml = renderMarkdown(content)
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
        stableHtml += sanitizeAgentHtml(renderRaw(segment))
        stableSource = content.slice(0, cut)
      }

      const tail = content.slice(stableSource.length)
      const openFence = hasOpenFence(tail)
      suppressHighlight = openFence
      let tailHtml: string
      try {
        tailHtml = sanitizeAgentHtml(renderRaw(closeUnclosedFences(tail)))
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
