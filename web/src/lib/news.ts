/**
 * 资讯条目的整理层。
 *
 * 后端给的是富文本 HTML + 一个截断到 30 字的摘要，页面上要的是能排版的
 * 字段：日期、导语、字数、章节。集中在这里，页面只管摆。
 */

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
}

/** 后端给的是 "2026-10-22 15:59:59"，没有时区，也带不上 ISO 的 T。 */
export function newsDate(value?: string): { date: string; time: string } {
  if (!value) return { date: "—", time: "" }
  const match = DATE_PATTERN.exec(value.trim())
  if (!match) return { date: value, time: "" }
  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    time: match[4] ? `${match[4]}:${match[5]}` : "",
  }
}

/** 去掉 HTML 标签，保留可读文字。 */
export function newsPlainText(html?: string): string {
  if (!html) return ""
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h2|h3|li|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim()
}

/** 摘要优先用后端给的；没有就从正文里截。 */
export function newsExcerpt(html?: string, summary?: string, max = 96): string {
  const source = (summary ?? "").trim() || newsPlainText(html)
  if (!source) return ""
  const flat = source.replace(/\s+/g, " ").trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max).trimEnd()}…`
}

/**
 * 正文开头的一段。
 *
 * 无封面条目没有照片可上，格子里摆的就是它自己的第一段——短文是全文，
 * 长文取首段。比摘要可靠：短文的摘要是标题的回声，正文不是。
 */
export function newsOpening(html?: string, max = 88): string {
  const flat = newsPlainText(html).replace(/\s+/g, " ").trim()
  if (!flat) return ""
  if (flat.length <= max) return flat
  return `${flat.slice(0, max).trimEnd()}…`
}

/** 中英混排的字数：汉字按字计，英文按词计。 */
export function newsWordCount(html?: string): number {
  const text = newsPlainText(html)
  if (!text) return 0
  const cjk = text.match(/[㐀-鿿]/g)?.length ?? 0
  const words = text.replace(/[㐀-鿿]/g, " ").match(/[A-Za-z0-9]+/g)?.length ?? 0
  return cjk + words
}

/** 正文里的一级章节（后端正文的结构是 <p> + <h2>）。 */
export function newsSections(html?: string): { id: string; text: string }[] {
  if (!html) return []
  const sections: { id: string; text: string }[] = []
  const pattern = /<h2([^>]*)>([\s\S]*?)<\/h2>/gi
  let match = pattern.exec(html)
  while (match) {
    const text = match[2].replace(/<[^>]+>/g, "").trim()
    if (text) {
      const own = /\bid\s*=\s*"([^"]+)"/.exec(match[1] ?? "")
      sections.push({ id: own ? own[1] : `news-sec-${sections.length + 1}`, text })
    }
    match = pattern.exec(html)
  }
  return sections
}

/** 给正文里的 <h2> 补上锚点 id，目录才跳得过去。 */
export function newsWithAnchors(html: string): string {
  let index = 0
  return html.replace(/<h2(\s[^>]*)?>/gi, (whole, attrs: string | undefined) => {
    index += 1
    // 已经有 id 的保留原样，避免覆盖正文自带的锚点。
    if (attrs && /\bid\s*=/.test(attrs)) return whole
    return `<h2${attrs ?? ""} id="news-sec-${index}">`
  })
}
