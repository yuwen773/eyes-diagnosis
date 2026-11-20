/**
 * 章节头：一行可读的章节信息，不再是压在标题上的微型眉线。
 *
 * 两套调用口径都支持：
 *  - 旧：code + kicker + en（各页面大量在用）
 *  - 新：code + title + note（落地页，句子式）
 * 统一渲染成一行 15px 正文：短码 + 章节名 + 补充说明，
 * 大小写不拉伸、不做 uppercase tracking（DESIGN.md §12 已知债）。
 */
export function SectionHead({
  code,
  kicker,
  en,
  title,
  note,
}: {
  code?: string
  kicker?: string
  en?: string
  title?: string
  note?: string
}) {
  const heading = title ?? kicker ?? ""
  const tail = note ?? en ?? ""
  return (
    <div className="sec-head">
      <p className="sec-head__line">
        {code ? <span className="sec-head__code num">{code}</span> : null}
        <span className="sec-head__title">{heading}</span>
        {tail ? <span className="sec-head__note">{tail}</span> : null}
      </p>
    </div>
  )
}
