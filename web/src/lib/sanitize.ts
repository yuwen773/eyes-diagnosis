import DOMPurify from "dompurify"

/**
 * 放行排版需要的标签与属性。
 *
 * 白名单里含 h1 / pre / code / table 一族：正文现在由 Markdown 渲染而来，
 * 这些结构是正文的一部分，剥掉等于把编辑部写的内容删了。
 * 外链一律新开并带 noopener，其余一律丢掉。
 */

const ALLOWED_TAGS = [
  "p",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "del",
  "ul",
  "ol",
  "li",
  "a",
  "img",
  "blockquote",
  "pre",
  "code",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "span",
  "div",
]

const ALLOWED_ATTR = ["href", "src", "alt", "title", "class", "colspan", "rowspan", "start"]

let hooked = false

/**
 * 是否放行远程图片。
 *
 * <p>编辑部写的资讯里放行远程图没问题——那是自己配的图。
 * 但知识库里管理员上传的文档是外部来源：一段 Markdown 里的
 * {@code ![](https://第三方/track.gif)} 会让管理员的浏览器向第三方发请求
 * （像素级追踪），还会把内网可达的地址泄露出去。所以文档那条路径关掉它，
 * 只留 data: / blob:。
 */
let allowRemoteImages = true

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
      if (!allowRemoteImages) {
        const src = node.getAttribute("src") ?? ""
        if (!/^(data:|blob:)/i.test(src)) {
          // 整个节点拿掉：只摘 src 会留下一个破图占位。
          node.remove()
        }
      }
    }
  })
}

export type SanitizeOptions = {
  /** 默认放行远程图片；上传文档这类外部来源要传 false。 */
  allowRemoteImages?: boolean
}

export function sanitizeNewsHtml(html?: string, options?: SanitizeOptions): string {
  if (!html) return ""
  ensureHook()
  allowRemoteImages = options?.allowRemoteImages ?? true
  try {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
    })
  } finally {
    allowRemoteImages = true
  }
}
