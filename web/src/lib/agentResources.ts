/**
 * 会话资源（右侧「资源」面板）的单一数据源。
 *
 * <p>资源不是独立维护的一份状态，而是**从会话消息派生**的：每次渲染现算。
 * 只有这样，「刷新页面 / 切换会话 / 历史回放」才和「刚聊完」得到同一份结果，
 * 不会出现资源只在内存里活一轮、刷新就丢的问题。
 *
 * <p>三类资源各有各的来路，互不冒充：
 * <ul>
 *   <li>`image` —— 用户上传的影像、助手/工具正文里真实出现的图片。</li>
 *   <li>`document` —— **只**来自后端检索工具的结构化引用（文档 ID / 相关度 /
 *       片段都由检索结果给出）。不从模型生成的 Markdown 里反推「文献」。没有
 *       文档 ID 的片段不进证据栏。</li>
 *   <li>`link` —— 正文里真实出现的 http(s) 链接，经协议校验与去重。普通外链
 *       不是医学证据，面板不会给它贴证据标签。</li>
 * </ul>
 */

/** 资源类别。 */
export type ResourceKind = "image" | "document" | "link"

/**
 * 资源出处。`knowledge-base` 只可能由后端检索工具写入，
 * 前端任何解析路径都不得伪造这一类。
 */
export type ResourceSource = "upload" | "assistant" | "tool" | "knowledge-base"

export type AgentResource = {
  /** 稳定标识，同一会话内去重键。 */
  id: string
  kind: ResourceKind
  title: string
  source: ResourceSource
  /** 图片/链接地址；文档类为空。 */
  url?: string
  /** 知识库文档标识（来自检索结果）。 */
  documentId?: string
  /** 检索相关度——只有检索结果真的带分数时才有。 */
  score?: number
  /**
   * 原始检索分。rerank 生效且成功时，`score` 是重排序分，这里单独保留检索分；
   * 没有 rerank 时为空（两个分数同源，不重复展示）。
   */
  retrievalScore?: number
  /** 命中的片段原文。 */
  snippet?: string
  /** 链接域名（展示用）。 */
  domain?: string
  /** 产生这条资源的消息，用于「定位到消息」。 */
  messageId?: string
  /** 产生这条资源的工具调用，用于「定位到执行步骤」。 */
  toolCallId?: string
  /** 所属回合（从 1 开始，按用户提问切分），用于按回合筛选。 */
  round?: number
}

export type AgentResources = {
  images: AgentResource[]
  documents: AgentResource[]
  links: AgentResource[]
}

export const EMPTY_RESOURCES: AgentResources = Object.freeze({
  images: [],
  documents: [],
  links: [],
}) as AgentResources

/** 派生的最小消息形状。不直接依赖 StreamMessage，避免循环引用。 */
export type ResourceSourceMessage = {
  id: string
  type: string
  content: string
  /** 用户轮次上传的图片。 */
  images?: string[]
  /** 后端随工具结果下发的结构化资源。 */
  resources?: AgentResource[]
}

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
/** (?<!!) 排除图片语法 ![alt](url)，只留普通链接 [title](url)。 */
const LINK_RE = /(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

/** 只放行 http/https 的绝对地址；`javascript:` 一类一律拒绝。 */
function toHttpUrl(raw: string | undefined | null): URL | null {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  // 带用户名/密码的 URL 既是可疑地址，也是凭据泄露点
  if (url.username || url.password) return null
  return url
}

/**
 * 图片地址归一：接受 http(s) 绝对地址，也接受站内根相对路径（`/uploads/x.png`）。
 * 返回去重用的字符串；不安全返回 null。
 */
function toMediaUrl(raw: string | undefined | null): string | null {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return null
  if (trimmed.startsWith("//") || trimmed.startsWith("\\")) return null
  if (trimmed.startsWith("/")) return trimmed
  const url = toHttpUrl(trimmed)
  return url ? url.toString() : null
}

/** 服务端上传对象键的固定前缀（后端 `UploadCompensationService.OBJECT_KEY_PREFIX`）。 */
const UPLOAD_OBJECT_PREFIX = "/agent-chat/"

/**
 * 附件地址准入：什么样的地址才可以被当成「用户上传的影像」去渲染。
 *
 * <p>只认两类：站内根相对路径，以及上传命名空间里的 https 地址
 * （`https://<cosHost>/agent-chat/<userId>/<uuid>.png`）。其余——包括任何第三方
 * https 地址——一律不当作附件：图片一旦渲染，就等于把「这位用户看过这一页」
 * 告诉了外站。地址形状只是第二道闸，第一道是落库信封上的服务端标记。
 */
export function isTrustedAttachmentUrl(raw: string | undefined | null): boolean {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return false
  if (trimmed.startsWith("//") || trimmed.startsWith("\\")) return false
  if (trimmed.startsWith("/")) return true
  const url = toHttpUrl(trimmed)
  if (!url) return false
  if (url.protocol === "https:" && url.pathname.startsWith(UPLOAD_OBJECT_PREFIX)) return true
  // 同源绝对地址（本地开发与反向代理同域部署）不产生跨站请求，可以放行
  if (typeof window !== "undefined" && url.origin === window.location.origin) return true
  return false
}

function normalizeHttpUrl(url: URL): string {
  const copy = new URL(url.toString())
  copy.hash = ""
  return copy.toString()
}

const SOURCES: readonly ResourceSource[] = ["upload", "assistant", "tool", "knowledge-base"]

function asSource(value: unknown, fallback: ResourceSource): ResourceSource {
  return typeof value === "string" && (SOURCES as readonly string[]).includes(value)
    ? (value as ResourceSource)
    : fallback
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

/**
 * 图片是否可以在面板里自动加载。
 *
 * <p>用户上传的影像（后端存储）可以自动加载；正文里的图片只有同源才自动加载——
 * 第三方图片一旦自动拉取，就等于把「这位用户看过这一页」告诉外站，
 * 医学场景下这本身就是隐私泄露。
 */
export function isAutoLoadableImage(resource: AgentResource): boolean {
  if (resource.source === "upload") return true
  const url = resource.url
  if (!url) return false
  if (url.startsWith("/") && !url.startsWith("//")) return true
  if (typeof window === "undefined") return false
  try {
    return new URL(url).origin === window.location.origin
  } catch {
    return false
  }
}

/**
 * 后端结构化资源（SSE 的 `resources` / 历史落库里的 `resources`）→ 前端资源。
 *
 * <p>这里只做**校验与归一**，不做补全：缺文档 ID 的文档条目直接丢掉，
 * 协议不合法的链接直接丢掉——宁可少一条，不可造一条。
 */
export function parseResourceRefs(raw: unknown): AgentResource[] {
  if (!Array.isArray(raw)) return []
  const out: AgentResource[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const obj = item as Record<string, unknown>
    const kind = asText(obj.kind)
    const toolCallId = asText(obj.toolCallId)

    if (kind === "image") {
      const url = toMediaUrl(typeof obj.url === "string" ? obj.url : undefined)
      if (!url) continue
      out.push({
        id: asText(obj.id) ?? `image:${url}`,
        kind: "image",
        title: asText(obj.title) ?? "图片",
        source: asSource(obj.source, "tool"),
        url,
        toolCallId,
      })
      continue
    }

    if (kind === "document") {
      const documentId = asText(obj.documentId)
      // 没有稳定文档标识的片段不能当「可核验来源」展示。
      if (!documentId) continue
      const score =
        typeof obj.score === "number" && Number.isFinite(obj.score) ? obj.score : undefined
      const retrievalScore =
        typeof obj.retrievalScore === "number" && Number.isFinite(obj.retrievalScore)
          ? obj.retrievalScore
          : undefined
      out.push({
        id: asText(obj.id) ?? `doc:${documentId}`,
        kind: "document",
        title: asText(obj.title) ?? "知识库文档",
        source: "knowledge-base",
        documentId,
        score,
        retrievalScore,
        snippet: asText(obj.snippet),
        toolCallId,
      })
      continue
    }

    if (kind === "link") {
      const url = toHttpUrl(typeof obj.url === "string" ? obj.url : undefined)
      if (!url) continue
      const normalized = normalizeHttpUrl(url)
      out.push({
        id: asText(obj.id) ?? `link:${normalized}`,
        kind: "link",
        title: asText(obj.title) ?? url.hostname,
        source: asSource(obj.source, "tool"),
        url: normalized,
        domain: url.hostname,
        toolCallId,
      })
    }
  }
  return out
}

/**
 * 从整段会话消息派生资源列表。
 *
 * <p>纯函数、按出现顺序去重（同 id 先到先得）：后出现的同一条资源不会把
 * 先出现的出处改掉——比如助手把用户上传的图再贴一遍，它仍然是「你的上传」。
 */
export function deriveResources(messages: readonly ResourceSourceMessage[]): AgentResources {
  const images: AgentResource[] = []
  const documents: AgentResource[] = []
  const links: AgentResource[] = []
  const seen = new Set<string>()
  let round = 0

  const add = (resource: AgentResource) => {
    if (!resource.id || seen.has(resource.id)) return
    seen.add(resource.id)
    if (resource.kind === "image") images.push(resource)
    else if (resource.kind === "document") documents.push(resource)
    else links.push(resource)
  }

  for (const msg of messages) {
    const messageId = msg.id
    // 用户提问切回合：同一回合的图片、检索来源、链接都归到同一个序号下。
    if (msg.type === "user") round += 1

    if (msg.type === "user") {
      for (const raw of msg.images ?? []) {
        const url = toMediaUrl(raw)
        if (!url) continue
        add({
          id: `image:${url}`,
          kind: "image",
          title: "上传的影像",
          source: "upload",
          url,
          messageId,
          round,
        })
      }
    }

    for (const ref of msg.resources ?? []) {
      add({ ...ref, messageId: ref.messageId ?? messageId, round: ref.round ?? round })
    }

    const source: ResourceSource | null =
      msg.type === "assistant" ? "assistant" : msg.type === "tool-response" ? "tool" : null
    if (!source || !msg.content) continue

    for (const match of msg.content.matchAll(IMAGE_RE)) {
      const url = toMediaUrl(match[2])
      if (!url) continue
      add({
        id: `image:${url}`,
        kind: "image",
        title: match[1]?.trim() || "图片",
        source,
        url,
        messageId,
        round,
      })
    }

    for (const match of msg.content.matchAll(LINK_RE)) {
      const url = toHttpUrl(match[2])
      if (!url) continue
      const normalized = normalizeHttpUrl(url)
      add({
        id: `link:${normalized}`,
        kind: "link",
        title: match[1]?.trim() || url.hostname,
        source,
        url: normalized,
        domain: url.hostname,
        messageId,
        round,
      })
    }
  }

  return { images, documents, links }
}

/** 资源总数（顶栏角标用）。 */
export function countResources(resources: AgentResources): number {
  return resources.images.length + resources.documents.length + resources.links.length
}
