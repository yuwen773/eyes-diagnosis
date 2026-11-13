import type { Fault, FaultAction } from "@/lib/faults"

/**
 * 故障读数（行内 / 整块）。
 *
 * 表单校验、字段没填对、局部操作失败走 block；贴着输入框的一行小字走 field；
 * 整页取不到数走 panel。三种尺度共用一套语法：左边一道语义色竖线、
 * 一个等宽标签、一句结论、必要的读数与动作。
 */
export function FaultNote({
  fault,
  variant = "block",
  action,
  readouts,
  className = "",
}: {
  fault: Fault
  variant?: "block" | "field" | "panel"
  /** 覆盖故障自带的动作（例如表单级提示自己给「重试」）。 */
  action?: FaultAction
  /** panel 尺度下的读数行：状态码、端点这类对得上号的数字。 */
  readouts?: { label: string; value: string }[]
  className?: string
}) {
  const act = action ?? fault.action
  const tone = `fault-tone-${fault.severity}`

  if (variant === "panel") {
    return (
      <section
        className={`fault-note fault-note--panel ${tone}${className ? ` ${className}` : ""}`}
        role="alert"
      >
        <div className="fault-panel__head">
          <span className="fault-panel__tag num">{fault.tag}</span>
          <span className="fault-panel__rule" aria-hidden="true" />
        </div>
        <h2 className="fault-panel__title">{fault.title}</h2>
        {fault.detail && <p className="fault-panel__body">{fault.detail}</p>}
        {(readouts?.length || act) && (
          <div className="fault-panel__foot">
            {readouts?.map((row) => (
              <div className="fault-panel__readout" key={row.label}>
                <span className="fault-panel__label">{row.label}</span>
                <span className="fault-panel__value num">{row.value}</span>
              </div>
            ))}
            {act && (
              <button type="button" className="fault-panel__action" onClick={act.run}>
                {act.label}
              </button>
            )}
          </div>
        )}
      </section>
    )
  }

  return (
    <div
      className={`fault-note ${tone}${variant === "field" ? " fault-note--field" : ""}${className ? ` ${className}` : ""}`}
      role="alert"
    >
      {variant !== "field" && <span className="fault-note__tag num">{fault.tag}</span>}
      <p className="fault-note__text">
        <span className="fault-note__title">{fault.title}</span>
        {fault.detail && <span className="fault-note__detail">{fault.detail}</span>}
      </p>
      {act && (
        <button type="button" className="fault-note__action" onClick={act.run}>
          {act.label}
        </button>
      )}
    </div>
  )
}
