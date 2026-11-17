import { useState } from "react"
import { X } from "lucide-react"
import type { AgentResources } from "@/lib/agentResources"

/**
 * 右侧资源面板：图片 / 链接双 tab。数据来自流中 tool-response 的提取累积。
 *
 * <p>**证据边界**：这里列的是工具返回里的图片与链接，它们**不是**经过
 * 标注的临床证据。后端目前没有提供来源、等级或相关度字段，所以面板里
 * 就不出现文献编号、证据等级或相关度分数——补造这些等于伪造出处。
 */
export function ResourcePanel({
  open,
  resources,
  onClose,
  onPreviewImage,
}: {
  open: boolean
  resources: AgentResources
  onClose: () => void
  onPreviewImage: (url: string) => void
}) {
  const [tab, setTab] = useState<"images" | "links">("images")
  if (!open) return null

  const imageCount = resources.images.length
  const linkCount = resources.links.length

  return (
    <aside className="agent-panel">
      <div className="agent-panel__head">
        <h2 className="agent-panel__title">本回合资源</h2>
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
        <button
          type="button"
          role="tab"
          aria-selected={tab === "images"}
          className={`agent-panel__tab${tab === "images" ? " is-active" : ""}`}
          onClick={() => setTab("images")}
        >
          图片 <span className="agent-panel__count">{imageCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "links"}
          className={`agent-panel__tab${tab === "links" ? " is-active" : ""}`}
          onClick={() => setTab("links")}
        >
          链接 <span className="agent-panel__count">{linkCount}</span>
        </button>
      </div>

      <div className="agent-panel__body">
        {tab === "images" &&
          (imageCount === 0 ? (
            <p className="agent-panel__empty">本回合还没有工具返回图片。</p>
          ) : (
            <div className="agent-panel__imggrid">
              {resources.images.map((img) => (
                <button
                  key={img.url}
                  type="button"
                  className="agent-panel__img"
                  onClick={() => onPreviewImage(img.url)}
                  title={img.title}
                >
                  <img src={img.url} alt={img.title} loading="lazy" />
                </button>
              ))}
            </div>
          ))}

        {tab === "links" &&
          (linkCount === 0 ? (
            <p className="agent-panel__empty">本回合还没有工具返回链接。</p>
          ) : (
            <>
              <ul className="agent-panel__links">
                {resources.links.map((link) => (
                  <li key={link.url} className="agent-panel__link">
                    <a href={link.url} target="_blank" rel="noreferrer">
                      <span className="agent-panel__linktitle">{link.title}</span>
                      <span className="agent-panel__linkdomain">{link.domain}</span>
                    </a>
                  </li>
                ))}
              </ul>
              <p className="agent-panel__caveat">
                以上是工具返回的普通链接，后端未提供来源与证据等级字段，
                因此这里不标注文献编号或相关度。
              </p>
            </>
          ))}
      </div>
    </aside>
  )
}
