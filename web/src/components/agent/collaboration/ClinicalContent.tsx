import {
  sectionLabels,
  type Claim,
  type Explanation,
  type Source,
} from "@/lib/reviewApi"

export function ClinicalClaims({
  claims,
  onSource,
  showIds = false,
}: {
  claims: Claim[]
  onSource?: (index: number) => void
  showIds?: boolean
}) {
  return (
    <div className="clinical-claims">
      {claims.map((claim) => (
        <section key={claim.id}>
          <h4>{sectionLabels[claim.section] ?? "补充信息"}</h4>
          {showIds && <p className="num">条目标识 {claim.id}</p>}
          <p>{claim.text}</p>
          {claim.references.map((reference, index) =>
            onSource ? (
              <button
                type="button"
                className="collab-text-button"
                key={index}
                onClick={() => onSource(reference.citationIndex)}
              >
                查看依据 {reference.citationIndex + 1}
              </button>
            ) : (
              <blockquote key={index}>
                <span className="num">
                  依据 {reference.citationIndex + 1} ·{" "}
                </span>
                {reference.quote}
              </blockquote>
            )
          )}
        </section>
      ))}
    </div>
  )
}
export function ClinicalSource({ source }: { source: Source }) {
  return (
    <section className="clinical-source">
      <h4>
        依据 <span className="num">{source.citationIndex + 1}</span> ·{" "}
        {source.title}
      </h4>
      <p>{source.source}</p>
      <p className="num">
        文档版本 {source.documentVersion} · 治理版本 {source.governanceVersion}
      </p>
      <blockquote>{source.excerpt}</blockquote>
    </section>
  )
}
export function ClinicalExplanation({
  explanation,
}: {
  explanation: Explanation
}) {
  return (
    <>
      <p className="clinical-notice">{explanation.disclaimer}</p>
      <p>{explanation.calibrationNotice}</p>
      <ClinicalClaims claims={explanation.claims} />
      <details>
        <summary>全部依据与限制</summary>
        {explanation.sources.map((source) => (
          <ClinicalSource key={source.citationIndex} source={source} />
        ))}
      </details>
    </>
  )
}
