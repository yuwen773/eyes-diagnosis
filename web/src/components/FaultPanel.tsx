/**
 * 仪器故障面板。
 *
 * 读取失败不该是一条横贯整页的粉红横幅——那是句号，不是仪表。
 * 这里按仪器的读数面板来搭：左边一道故障色竖线，中间说清发生了什么，
 * 底下把状态码和端点摆出来，右端一个重试。
 * 故障色用风险语义色（--risk-critical），不占用信号橙。
 */
export function FaultPanel({
  code,
  title,
  body,
  endpoint,
  onRetry,
}: {
  code: number | null
  title: string
  body: string
  /** 出问题的那个调用，写成让人能对得上号的读数。 */
  endpoint: string
  onRetry: () => void
}) {
  return (
    <section className="fault" role="alert">
      <div className="fault__head">
        <span className="fault__tag num">FAULT</span>
        <span className="fault__rule" aria-hidden="true" />
      </div>

      <h2 className="fault__title">{title}</h2>
      <p className="fault__body">{body}</p>

      <div className="fault__foot">
        <div className="fault__readout">
          <span className="readout__label">状态</span>
          <span className="readout__value readout__value--mono">{code ?? "—"}</span>
        </div>
        <div className="fault__readout">
          <span className="readout__label">端点</span>
          <span className="readout__value readout__value--mono">{endpoint}</span>
        </div>
        <button className="btn btn--sm fault__retry" type="button" onClick={onRetry}>
          重试
          <span className="btn__key">↻</span>
        </button>
      </div>
    </section>
  )
}
