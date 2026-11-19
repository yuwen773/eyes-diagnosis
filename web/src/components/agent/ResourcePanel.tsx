import { useEffect, useMemo, useRef, useState } from "react"
import { ExternalLink, FileText, ImageOff, LocateFixed, X } from "lucide-react"

import {
  evidenceKeyOf,
  isAutoLoadableImage,
  roundsOf,
  type AgentResource,
  type AgentResources,
} from "@/lib/agentResources"

type PanelTab = "images" | "documents" | "links"

/**
 * 右侧资源面板：会话资源与证据中心。
 *
 * <p>**证据边界**：只有知识库来源这一类属于「可核验的参考资料」，而且它的
 * 文档 ID / 相关度 / 片段全部来自后端检索结果；助手正文里的普通外链不是
 * 医学证据，面板只在链接上标出处，不给它贴证据标签。
 *
 * <p>资源为空是合法状态：本会话确实没有图片 / 没有命中知识库 / 没有外链。
 * 面板宁可显示空态，也不拿模型生成的「文献名」来填充。
 */
export function ResourcePanel({
  open,
  resources,
  onClose,
  onPreviewImage,
  onLocate,
  focus,
}: {
  open: boolean
  resources: AgentResources
  onClose: () => void
  onPreviewImage: (url: string) => void
  /** 把资源定位回它的消息 / 工具步骤；目标不存在时不显示按钮。 */
  onLocate?: (resource: AgentResource) => void
  /**
   * 从正文证据角标跳进来：切到「知识来源」、筛到对应回合并高亮那一段。
   * `nonce` 让连点同一角标也能再次触发。
   */
  focus?: { key: string; nonce: number } | null
}) {
  const [picked, setPicked] = useState<PanelTab | null>(null)
  const [round, setRound] = useState<number | "all">("all")

  const rounds = useMemo(() => {
    const set = new Set<number>()
    for (const list of [resources.images, resources.documents, resources.links]) {
      for (const item of list) for (const value of roundsOf(item)) set.add(value)
    }
    return [...set].sort((a, b) => b - a)
  }, [resources])

  // 按「所有检索到过的回合」筛，而不是只看首次出现：同一片段在后面的回合
  // 又被检索到时，它也是本轮来源，不能因为首次出现更早就被筛掉。
  const filter = (list: AgentResource[]) =>
    round === "all" ? list : list.filter((item) => roundsOf(item).includes(round))

  const images = filter(resources.images)
  const documents = filter(resources.documents)
  const links = filter(resources.links)

  // 默认停在第一个有内容的类别；三类都空时停在「影像」并显示空态。
  const autoTab: PanelTab =
    resources.images.length > 0
      ? "images"
      : resources.documents.length > 0
        ? "documents"
        : resources.links.length > 0
          ? "links"
          : "images"
  const tab: PanelTab = picked ?? autoTab

  // 正文角标 → 面板：切页签与回合是「props 变了就调整状态」，在渲染期直接改，
  // 不放进 effect（effect 里同步 setState 会多一轮级联渲染）。回合放宽到全部：
  // 引用的片段可能来自上一答，宁可多给一条也不装「找不到」。
  const [handledFocus, setHandledFocus] = useState<number | null>(null)
  if (focus && focus.nonce !== handledFocus) {
    setHandledFocus(focus.nonce)
    setPicked("documents")
    setRound("all")
  }

  // 滚动与高亮是真正的外部系统操作，放在 effect 里；按 nonce 去重，
  // 避免后续无关渲染把同一个目标反复滚动。
  const bodyRef = useRef<HTMLDivElement>(null)
  const appliedFocus = useRef<number | null>(null)
  const focusTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!open || !focus || tab !== "documents") return
    if (focus.nonce === appliedFocus.current) return
    const el = [...(bodyRef.current?.querySelectorAll<HTMLElement>("[data-evidence-key]") ?? [])].find(
      (node) => node.getAttribute("data-evidence-key") === focus.key,
    )
    if (!el) return
    appliedFocus.current = focus.nonce
    el.scrollIntoView({ block: "center", behavior: "smooth" })
    el.classList.add("is-located")
    // 键盘用户也要落到这一段，否则「定位」只对鼠标成立。
    el.focus({ preventScroll: true })
    if (focusTimer.current !== null) window.clearTimeout(focusTimer.current)
    focusTimer.current = window.setTimeout(() => {
      el.classList.remove("is-located")
      focusTimer.current = null
    }, 1600)
    // round 与列表本身都要看：切回合 / 新资源到达后元素才真的在 DOM 里。
  }, [open, tab, round, focus, documents])

  useEffect(
    () => () => {
      if (focusTimer.current !== null) window.clearTimeout(focusTimer.current)
    },
    [],
  )

  if (!open) return null

  const tabs: { key: PanelTab; label: string; count: number }[] = [
    { key: "images", label: "影像", count: images.length },
    { key: "documents", label: "知识来源", count: documents.length },
    { key: "links", label: "链接", count: links.length },
  ]

  return (
    <aside className="agent-panel" aria-label="会话资源">
      <div className="agent-panel__head">
        <div>
          <h2 className="agent-panel__title">会话资源</h2>
          <p className="agent-panel__subtitle">
            影像 {resources.images.length} · 来源 {resources.documents.length} · 链接{" "}
            {resources.links.length}
          </p>
        </div>
        <button
          type="button"
          className="agent-panel__close"
          onClick={onClose}
          aria-label="关闭资源面板"
          title="关闭资源面板"
        >
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <div className="agent-panel__tabs" role="tablist" aria-label="资源类型">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`agent-panel__tab${tab === item.key ? " is-active" : ""}`}
            onClick={() => setPicked(item.key)}
          >
            {item.label} <span className="agent-panel__count num">{item.count}</span>
          </button>
        ))}
      </div>

      {rounds.length > 1 ? (
        <div className="agent-panel__filter">
          <label className="agent-panel__filterlabel" htmlFor="agent-resource-round">
            回合
          </label>
          <select
            id="agent-resource-round"
            className="agent-panel__select"
            value={round === "all" ? "all" : String(round)}
            onChange={(event) => {
              const value = event.target.value
              setRound(value === "all" ? "all" : Number(value))
            }}
          >
            <option value="all">全部回合</option>
            {rounds.map((value) => (
              <option key={value} value={String(value)}>
                第 {value} 回合
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="agent-panel__body" ref={bodyRef}>
        {tab === "images" ? (
          images.length === 0 ? (
            <p className="agent-panel__empty">
              {resources.images.length === 0
                ? "这个会话里还没有影像。上传眼底照片后，原图会登记在这里。"
                : "这个回合没有影像。"}
            </p>
          ) : (
            <div className="agent-panel__imggrid">
              {images.map((image) => (
                <PanelImage
                  key={image.id}
                  resource={image}
                  onPreview={onPreviewImage}
                />
              ))}
            </div>
          )
        ) : null}

        {tab === "documents" ? (
          documents.length === 0 ? (
            <p className="agent-panel__empty">
              {resources.documents.length === 0
                ? "这个会话没有命中知识库来源。只有检索工具真实命中的文档会出现在这里。"
                : "这个回合没有检索命中。"}
            </p>
          ) : (
            <>
              <ul className="agent-panel__docs">
                {documents.map((doc) => (
                  <li
                    key={doc.id}
                    className="agent-panel__doc"
                    // 正文证据角标按这个键定位到具体片段（同一文档两段各一条）。
                    data-evidence-key={evidenceKeyOf(doc) ?? undefined}
                    tabIndex={-1}
                  >
                    <div className="agent-panel__dochead">
                      <span className="agent-panel__badge">
                        <FileText size={12} strokeWidth={2} aria-hidden="true" />
                        知识库
                      </span>
                      {typeof doc.score === "number" ? (
                        <span className="agent-panel__score num">
                          相关度 {doc.score.toFixed(2)}
                        </span>
                      ) : null}
                    </div>
                    <p className="agent-panel__doctitle">{doc.title}</p>
                    {doc.snippet ? (
                      <p className="agent-panel__snippet">{doc.snippet}</p>
                    ) : null}
                    <div className="agent-panel__doctail">
                      {doc.documentId ? (
                        <span className="agent-panel__docid num">#{doc.documentId}</span>
                      ) : null}
                      {/* 片段序号与文档 ID 同属检索结果：同一文档命中两段会各占一条。 */}
                      {doc.chunkIndex !== undefined ? (
                        <span className="agent-panel__docid num">片段 {doc.chunkIndex}</span>
                      ) : null}
                      <LocateButton resource={doc} onLocate={onLocate} toolFirst />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="agent-panel__caveat">
                来源信息（文档 ID、相关度、片段）取自检索结果本身，不是模型生成的引用。
                正文角标只按本回合这里的片段核验；不在其中的会标成「未核验」。
              </p>
            </>
          )
        ) : null}

        {tab === "links" ? (
          links.length === 0 ? (
            <p className="agent-panel__empty">
              {resources.links.length === 0
                ? "这个会话里还没有出现外部链接。"
                : "这个回合没有外部链接。"}
            </p>
          ) : (
            <>
              <ul className="agent-panel__links">
                {links.map((link) => (
                  <li key={link.id} className="agent-panel__link">
                    <a href={link.url} target="_blank" rel="noreferrer noopener">
                      <span className="agent-panel__linktitle">{link.title}</span>
                      <span className="agent-panel__linkmeta">
                        <span className="agent-panel__linkdomain num">
                          {link.domain ?? link.url}
                        </span>
                        <span className="agent-panel__linktag">
                          {link.source === "assistant" ? "助手引用" : "工具返回"}
                        </span>
                        <ExternalLink size={11} strokeWidth={2} aria-hidden="true" />
                      </span>
                    </a>
                    <LocateButton resource={link} onLocate={onLocate} />
                  </li>
                ))}
              </ul>
              <p className="agent-panel__caveat">
                链接是对话里真实出现的地址，只有一方是助手或工具。它们不是医学证据，
                打开前请自行判断来源。
              </p>
            </>
          )
        ) : null}
      </div>
    </aside>
  )
}

/** 定位按钮：只有真的能定位到消息 / 步骤时才出现，不做点不动的装饰。 */
function LocateButton({
  resource,
  onLocate,
  toolFirst = false,
}: {
  resource: AgentResource
  onLocate?: (resource: AgentResource) => void
  toolFirst?: boolean
}) {
  if (!onLocate) return null
  const target = toolFirst
    ? resource.toolCallId
      ? "执行步骤"
      : resource.messageId
        ? "消息"
        : null
    : resource.messageId
      ? "消息"
      : null
  if (!target) return null
  return (
    <button
      type="button"
      className="agent-panel__locate"
      onClick={() => onLocate(resource)}
      title={`在对话中定位到这条资源的${target}`}
    >
      <LocateFixed size={12} strokeWidth={2} aria-hidden="true" />
      定位{target}
    </button>
  )
}

/**
 * 缩略图。用户上传的影像可以自动加载；助手正文里的第三方图片默认**不**拉取——
 * 自动加载等于把「这位用户看过这一页」告诉外站，医学场景下就是隐私泄露。
 * 需要用户显式点一下才加载与预览。
 */
function PanelImage({
  resource,
  onPreview,
}: {
  resource: AgentResource
  onPreview: (url: string) => void
}) {
  const auto = isAutoLoadableImage(resource)
  const [allowed, setAllowed] = useState(false)
  const [failed, setFailed] = useState(false)
  const url = resource.url ?? ""

  if (!auto && !allowed) {
    return (
      <button
        type="button"
        className="agent-panel__img is-gated"
        onClick={() => setAllowed(true)}
        title={`外部图片：${resource.title}`}
      >
        <ImageOff size={16} strokeWidth={1.8} aria-hidden="true" />
        <span>加载外部图片</span>
      </button>
    )
  }

  if (failed) {
    return (
      <div className="agent-panel__img is-failed" title={resource.title}>
        <ImageOff size={16} strokeWidth={1.8} aria-hidden="true" />
        <span>图片无法加载</span>
      </div>
    )
  }

  return (
    <button
      type="button"
      className="agent-panel__img"
      onClick={() => onPreview(url)}
      title={resource.title}
    >
      <img src={url} alt={resource.title} loading="lazy" onError={() => setFailed(true)} />
    </button>
  )
}
