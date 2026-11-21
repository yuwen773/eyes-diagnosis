import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react"

/**
 * 一轮回答的版本条。
 *
 * <p>只做两件事：重新生成这一轮，或在这一轮已有的几份回答之间切换。
 * **不比较、不评分**——界面不判断哪一版更好，只如实说明「这是第几份，
 * 共几份」。切换的权威在服务端（版本必须真实存在），失败就报错，不回退。
 */
export function TurnActions({
  variantIds,
  selectedVariantId,
  canRegenerate,
  busy,
  onRegenerate,
  onSelectVariant,
}: {
  /** 这一轮出现过的版本，按生成顺序。 */
  variantIds?: string[]
  /** 当前显示哪一份；null 表示旧数据（只有一份）。 */
  selectedVariantId?: string | null
  /** 只有最后一轮允许重新生成：更早的轮次没有后续上下文可回滚。 */
  canRegenerate: boolean
  busy: boolean
  onRegenerate?: () => void
  onSelectVariant?: (variantId: string) => void
}) {
  const versions = variantIds ?? []
  const total = versions.length
  const current = selectedVariantId ? versions.indexOf(selectedVariantId) : total - 1
  // 选中的版本不在列表里（旧数据/并发切换）：按「最后一份」显示，不假装选中别的。
  const index = current < 0 ? Math.max(0, total - 1) : current

  const jump = (delta: number) => {
    if (total < 2 || !onSelectVariant) return
    const next = (index + delta + total) % total
    onSelectVariant(versions[next])
  }

  if (!canRegenerate && total < 2) return null

  return (
    <div className="agent-turnbar" aria-label="回答版本">
      {canRegenerate ? (
        <button
          type="button"
          className="agent-turnbar__action"
          onClick={onRegenerate}
          disabled={busy || !onRegenerate}
          title="按这一轮的原文再生成一份回答；旧版本会保留，可随时切回"
        >
          <RotateCcw size={12} strokeWidth={2} aria-hidden="true" />
          重新生成
        </button>
      ) : null}

      {total > 1 ? (
        <span className="agent-turnbar__versions">
          <button
            type="button"
            className="agent-turnbar__arrow"
            aria-label="上一版回答"
            onClick={() => jump(-1)}
            disabled={busy}
          >
            <ChevronLeft size={13} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <span className="agent-turnbar__count num" aria-live="polite">
            {index + 1}/{total}
          </span>
          <button
            type="button"
            className="agent-turnbar__arrow"
            aria-label="下一版回答"
            onClick={() => jump(1)}
            disabled={busy}
          >
            <ChevronRight size={13} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </span>
      ) : null}
    </div>
  )
}
