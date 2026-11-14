import { useEffect, useMemo, useState, type ReactElement } from "react"
import { Check, ChevronDown, ChevronRight, Copy, TriangleAlert } from "lucide-react"

import type { KnowledgeChunk, KnowledgeDetail } from "@/lib/adminApi"

/** 首屏最多渲染的切片数：切片可能有上千块，一次铺完会把抽屉拖垮。 */
const PAGE = 30

/**
 * RAG 切片检查区。
 *
 * <p>切片序号来自后端按入库同一套解析 + 切分规则的重放（与向量库
 * {@code doc_{id}_chunk_{i}} 一一对应），所以「第 3 块」就是检索时真正会命中的
 * 第 3 块——这里不发明页码或段落定位，后端没给定位元数据就不假装能给。
 *
 * <p>三种「没有内容」必须分开说：读取失败（chunksReadable=false）、接口明确
 * 返回空数组、以及数据尚未到达（加载中）。前两种才算真实结果。
 */
export function ChunkInspector({ detail }: { detail: KnowledgeDetail }): ReactElement {
  const chunks = detail.chunks
  const [visible, setVisible] = useState(PAGE)
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set())
  const [copied, setCopied] = useState<number | null>(null)
  const [copyFailed, setCopyFailed] = useState<number | null>(null)

  // 复制回执只亮 1.6 秒；卸载时清定时器。
  useEffect(() => {
    if (copied === null && copyFailed === null) return
    const timer = window.setTimeout(() => {
      setCopied(null)
      setCopyFailed(null)
    }, 1600)
    return () => window.clearTimeout(timer)
  }, [copied, copyFailed])

  const total = chunks?.length ?? 0
  const shown = useMemo(() => (chunks ?? []).slice(0, visible), [chunks, visible])

  function toggle(index: number) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function copyChunk(chunk: KnowledgeChunk) {
    try {
      await navigator.clipboard.writeText(chunk.text)
      setCopyFailed(null)
      setCopied(chunk.index)
    } catch {
      setCopied(null)
      setCopyFailed(chunk.index)
    }
  }

  if (detail.chunksReadable === false) {
    const isDoc = detail.fileType?.toLowerCase() === "doc"
    return (
      <div className="admin-doc__chunks-state">
        <p className="admin-doc__chunks-fault">
          <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />
          {/* DOC 的「正文为空」是解析器不认这种二进制格式，不是扫描件问题。 */}
          {isDoc
            ? "DOC 不做在线解析：没有切片可对照。"
            : (detail.chunksMessage ?? "切片读取失败。")}
        </p>
        <p className="admin-doc__chunks-hint">
          {isDoc
            ? "DOC 是旧版二进制 Word 格式，本站不做在线解析；需要核对内容请下载原文件。这不是「切片为 0」——是不解析。"
            : "切片不可读通常意味着文件已不在对象存储里，或原文件被解析器判定为无正文（例如扫描件 PDF）。这不是「切片为 0」——是读不到。"}
        </p>
      </div>
    )
  }

  if (chunks === undefined) {
    return <p className="admin-doc__chunks-state">切片清单尚未返回。</p>
  }

  if (total === 0) {
    return (
      <div className="admin-doc__chunks-state">
        <p>该文档没有切片。</p>
        <p className="admin-doc__chunks-hint">
          接口明确返回了空列表。可对照原文确认是否正文过短或解析为空。
        </p>
      </div>
    )
  }

  return (
    <div className="admin-doc__chunk-wrap">
      <div className="admin-doc__chunks-summary num">
        <span>共 {total} 块</span>
        <span>
          {detail.status !== 1
            ? `尚未入库（状态：${detail.status === 0 ? "处理中" : "失败"}）`
            : total === (detail.chunkCount ?? 0)
              ? "每条与向量库序号一一对应"
              : `入库时 ${detail.chunkCount ?? 0} 块，按当前规则重放 ${total} 块`}
        </span>
      </div>
      {detail.status !== 1 ? (
        <p className="admin-doc__chunks-hint">
          以下是按入库同一套规则在本地重放的切片，编号与将来入库时一致；
          向量化没有完成前，检索不会命中这些块。
        </p>
      ) : null}

      <ol className="admin-doc__chunk-list">
        {shown.map((chunk) => {
          const isCollapsed = collapsed.has(chunk.index)
          const isCopied = copied === chunk.index
          const isCopyFailed = copyFailed === chunk.index
          return (
            <li key={chunk.index} className="admin-doc__chunk">
              <div className="admin-doc__chunk-head">
                <button
                  type="button"
                  className="admin-doc__chunk-toggle num"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggle(chunk.index)}
                >
                  {isCollapsed ? (
                    <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
                  )}
                  <span>CHUNK {String(chunk.index).padStart(2, "0")}</span>
                  <span className="admin-doc__chunk-chars">{chunk.chars} 字</span>
                </button>
                <button
                  type="button"
                  className="admin-doc__chunk-copy"
                  onClick={() => void copyChunk(chunk)}
                  aria-label={`复制第 ${chunk.index} 块切片`}
                  title="复制切片文本"
                >
                  {isCopied ? (
                    <Check size={13} strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <Copy size={13} strokeWidth={2} aria-hidden="true" />
                  )}
                  <span className="num">
                    {isCopied ? "已复制" : isCopyFailed ? "复制失败" : "复制"}
                  </span>
                </button>
              </div>
              {isCollapsed ? null : <p className="admin-doc__chunk-text">{chunk.text}</p>}
            </li>
          )
        })}
      </ol>

      {visible < total ? (
        <button
          type="button"
          className="admin-btn admin-btn--ghost admin-btn--sm admin-doc__chunk-more"
          onClick={() => setVisible((prev) => Math.min(prev + PAGE, total))}
        >
          再显示 {Math.min(PAGE, total - visible)} 块（还有 {total - visible} 块）
        </button>
      ) : null}
    </div>
  )
}
