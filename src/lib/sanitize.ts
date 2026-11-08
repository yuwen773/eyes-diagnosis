import DOMPurify from "dompurify"

/**
 * 正文净化。
 *
 * 资讯正文是编辑部存的富文本，直接 dangerouslySetInnerHTML 就是把后端
 * 当成可信来源。这里只放行排版需要的标签与属性，外链一律新开并带
 * noopener，其余一律丢掉。
 */

const ALLOWED_TAGS = [
  "p",
  "br",
  "hr",
  "h2",
  "h3",
  "h4",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "a",
  "img",
  "blockquote",
  "span",
  "div",
]

const ALLOWED_ATTR = ["href", "src", "alt", "title"]

let hooked = false

function ensureHook() {
  if (hooked) return
  hooked = true
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank")
      node.setAttribute("rel", "noopener noreferrer")
    }
    if (node.tagName === "IMG") {
      node.setAttribute("loading", "lazy")
    }
  })
}

export function sanitizeNewsHtml(html?: string): string {
  if (!html) return ""
  ensureHook()
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  })
}
