import { useState } from "react"
import type { AgentResources } from "@/lib/agentResources"

/** 右侧资源面板：图片/链接双 tab。数据来自流中 tool-response 的提取累积。 */
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
        <div className="agent-panel__tabs">
          <button
            type="button"
            className={`agent-panel__tab num${tab === "images" ? " is-active" : ""}`}
            onClick={() => setTab("images")}
          >
            图片 {imageCount}
          </button>
          <button
            type="button"
            className={`agent-panel__tab num${tab === "links" ? " is-active" : ""}`}
            onClick={() => setTab("links")}
          >
            链接 {linkCount}
          </button>
        </div>
        <button type="button" className="agent-panel__close" onClick={onClose} aria-label="关闭资源面板">
          ×
        </button>
      </div>

      <div className="agent-panel__body">
        {tab === "images" &&
          (imageCount === 0 ? (
            <p className="agent-panel__empty num">本回合暂无图片</p>
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
            <p className="agent-panel__empty num">本回合暂无链接</p>
          ) : (
            <ul className="agent-panel__links">
              {resources.links.map((link) => (
                <li key={link.url} className="agent-panel__link">
                  <a href={link.url} target="_blank" rel="noreferrer">
                    <span className="agent-panel__linktitle">{link.title}</span>
                    <span className="agent-panel__linkdomain num">{link.domain}</span>
                  </a>
                </li>
              ))}
            </ul>
          ))}
      </div>
    </aside>
  )
}
