/**
 * 从 agent 消息内容里提取图片与链接资源（右侧资源面板的数据源）。
 *
 * 全项目只有这一份正则——Vue 版在 useAgentStream / AssistantMessage / UserMessage
 * 各写了一份且互不相同（其中一处 (?!!) 负预查写错位置，从未生效）。
 */

export type AgentResources = {
  images: { url: string; title: string }[]
  links: { url: string; title: string; domain: string }[]
}

const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g
/** (?<!!) 排除图片语法 ![alt](url)，只留普通链接 [title](url)。 */
const LINK_RE = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g

/** 纯函数：从 content 提取资源并累积进 prev（按 URL 去重），不 mutate prev。 */
export function extractResources(content: string, prev: AgentResources): AgentResources {
  if (!content) return prev

  const images = [...prev.images]
  const seenImages = new Set(prev.images.map((img) => img.url))
  for (const match of content.matchAll(IMAGE_RE)) {
    const url = match[2]
    if (url && !seenImages.has(url)) {
      images.push({ url, title: match[1] || "图片" })
      seenImages.add(url)
    }
  }

  const links = [...prev.links]
  const seenLinks = new Set(prev.links.map((l) => l.url))
  for (const match of content.matchAll(LINK_RE)) {
    const url = match[2]
    if (!url || seenLinks.has(url)) continue
    try {
      links.push({ url, title: match[1], domain: new URL(url).hostname })
      seenLinks.add(url)
    } catch {
      // 无效 URL 跳过
    }
  }

  return { images, links }
}
