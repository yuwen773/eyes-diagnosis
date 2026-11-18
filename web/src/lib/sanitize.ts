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

/**
 * Agent 正文来自模型输出，除了资讯那套排版标签，还要保留代码块的
 * 「复制」按钮（`button.copy-btn` + `data-code` / `data-lang`）。
 * 不放行任何事件属性；链接协议由 DOMPurify 默认策略把关。
 */
const AGENT_ALLOWED_TAGS = [...ALLOWED_TAGS, "button"]
const AGENT_ALLOWED_ATTR = [
  ...ALLOWED_ATTR,
  "type",
  "disabled",
  "aria-label",
  "data-code",
  "data-lang",
]

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
  /** 默认放行远程图片；上传文档、Agent 正文这类外部来源要传 false。 */
  allowRemoteImages?: boolean
}

/** 临时切换远程图片策略；同步执行，结束后恢复上一档（可嵌套）。 */
function withRemoteImages<T>(allow: boolean, run: () => T): T {
  const previous = allowRemoteImages
  allowRemoteImages = allow
  try {
    return run()
  } finally {
    allowRemoteImages = previous
  }
}

export function sanitizeNewsHtml(html?: string, options?: SanitizeOptions): string {
  if (!html) return ""
  ensureHook()
  return withRemoteImages(options?.allowRemoteImages ?? true, () =>
    DOMPurify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
    }),
  )
}

/**
 * Agent 正文净化：白名单与资讯一致，额外放行代码块复制按钮。
 *
 * <p>Markdown 解析器已经关闭原始 HTML（`html: false`），这里仍再过一遍——
 * 语法高亮、链接自动识别、未来的插件都可能产出 HTML；纵深防御比信任
 * 单点配置便宜。`data-code` 只带代码文本，不参与任何 DOM 解释。
 *
 * <p>**不放行远程图片**：正文里的 `![](https://第三方/x.gif?d=症状)`
 * 会让读者的浏览器直接请求第三方——那是像素追踪，也会把画面里的医学信息
 * 拼进 URL 外带。知识库文档预览走的是同一条口径（`documentPreview.ts` 传
 * `allowRemoteImages: false`）。
 */
export function sanitizeAgentHtml(html?: string): string {
  if (!html) return ""
  ensureHook()
  return withRemoteImages(false, () =>
    DOMPurify.sanitize(html, {
      ALLOWED_TAGS: AGENT_ALLOWED_TAGS,
      ALLOWED_ATTR: AGENT_ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
    }),
  )
}
