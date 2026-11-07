export function SectionHead({
  code,
  kicker,
  en,
}: {
  code: string
  kicker: string
  en?: string
}) {
  return (
    <div className="sec-head">
      <span className="sec-head__code">{code}</span>
      <span className="sec-head__kicker">{kicker}</span>
      <span className="sec-head__rule" aria-hidden="true" />
      {en ? <span className="sec-head__en">{en}</span> : null}
    </div>
  )
}
