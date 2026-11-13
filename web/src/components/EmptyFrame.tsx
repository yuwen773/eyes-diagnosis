/**
 * 空的取景框。
 *
 * 有些条目没有封面图。给它一块空框而不是一块灰砖：框线是发丝线，四角是
 * 信号橙的定位角标——像样片张上那一格没曝到东西的底片。
 *
 * 带上 quote 时，框里摆的是这条资讯自己的第一段：没有照片就用话代替照片。
 */
export function EmptyFrame({
  label = "无封面",
  quote,
  className = "",
}: {
  label?: string
  quote?: string
  className?: string
}) {
  return (
    <div
      className={`empty-frame${quote ? " empty-frame--quote" : ""}${className ? ` ${className}` : ""}`}
    >
      <span className="empty-frame__mark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      {quote ? (
        <>
          <p className="empty-frame__quote">{quote}</p>
          <span className="empty-frame__rule" aria-hidden="true" />
        </>
      ) : (
        <span className="empty-frame__label num">{label}</span>
      )}
    </div>
  )
}
