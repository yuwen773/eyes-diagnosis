/**
 * 空的取景框。
 *
 * 有些条目没有封面图。给它一块空框而不是一块灰砖：框线是发丝线，四角是
 * 信号橙的定位角标——像样片张上那一格没曝到东西的底片。
 */
export function EmptyFrame({
  label = "无封面",
  className = "",
}: {
  label?: string
  className?: string
}) {
  return (
    <div className={`empty-frame${className ? ` ${className}` : ""}`}>
      <span className="empty-frame__mark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="empty-frame__label num">{label}</span>
    </div>
  )
}
