import type { ReactNode } from "react"
import type { DiagnosisResult } from "@/lib/api"
import { ClassScale } from "@/components/ClassScale"
import { ConfidenceDial } from "@/components/ConfidenceDial"
import { RiskTag } from "@/components/RiskTag"
import {
  archivalLabel,
  authorizationLabel,
  canonicalClassName,
  classCode,
  confidenceBand,
  confidencePercent,
  draftReviewLabel,
  formatTimestamp,
  humanReviewState,
  normalizeConfidence,
  rankClasses,
  recommendationLines,
  recordSourceLabel,
  reviewerRoleLabel,
  severityLabel,
  severityRisk,
  shortHash,
  TRIAGE_FALLBACK,
  isUrgentAdvice,
} from "@/lib/domain"

type RecordSheetProps = {
  result: DiagnosisResult
  recordId?: string
  actions?: ReactNode
  /** 示例记录不展示操作区。 */
  specimen?: boolean
  /** 本次判读的原始影像。有则作为证据栏出现在记录纸左侧。 */
  imageSrc?: string
  /** 皮肤：paper = 纸面（判读页，需 .is-sheet 钉回纸色）；night = 暗房仪器面板（落地页）。 */
  tone?: "paper" | "night"
}

/**
 * 影像归档只有一个真源：服务端的来源投影。
 *
 * `ARCHIVED` / `ARCHIVED_NOT_PUBLIC` 都是「对象已归档」，后者只是不给公开地址——
 * 协作影像走的就是这一档（`t_diagnosis.url` 恒为空），用地址空值反推会把它写成「未归档」。
 * `NOT_ARCHIVED` 才是真没有；`UNKNOWN` 与投影缺失都是「不知道」，不能落成「没有」。
 * 完全没有投影时（老记录、演示记录）才退回看地址，而且退路只说明地址存在。
 */
type ArchivalState = "archived" | "restricted" | "missing" | "unknown"

function archivalStateOf(source: DiagnosisResult["source"], imageSrc?: string): ArchivalState {
  switch (source?.imageArchivalState) {
    case "ARCHIVED":
      return "archived"
    case "ARCHIVED_NOT_PUBLIC":
      return "restricted"
    case "NOT_ARCHIVED":
      return "missing"
    case "UNKNOWN":
      return "unknown"
    default:
      return imageSrc ? "archived" : "missing"
  }
}

/**
 * 判读记录：整站唯一的报告呈现。
 * paper 皮肤在纸面上下文（.is-sheet）使用；night 皮肤消费暗房反转令牌。
 */
export function RecordSheet({ result, recordId, actions, specimen = false, imageSrc, tone = "paper" }: RecordSheetProps) {
  const rejected = Boolean(result.aiRejected)
  const rows = rankClasses(result)
  const confidence = normalizeConfidence(result.confidence ?? result.probability)
  const band = confidenceBand(result.confidence ?? result.probability)
  const review = humanReviewState(result.humanReviewStatus)
  // 来源投影只在本人详情接口下发；老记录/读取失败时为 undefined，整段不显示，
  // 绝不能退化成「没有授权、没有归档」。
  const source = result.source
  const archival = archivalStateOf(source, imageSrc)
  const recos = recommendationLines(result)
  const stampRisk = severityRisk(result.severity)
  // 主诊断用规范类名展示：后端枚举给的是短名（「糖尿病」），
  // 概率表里是规范名（「糖尿病视网膜病变」），同一张纸上得是同一个说法。
  const verdict = canonicalClassName(result.result) ?? result.result

  return (
    <article className={tone === "night" ? "sheet sheet--night" : "sheet is-sheet"} data-cursor>
      <header className="sheet__head">
        <span className="sheet__id">
          判读记录 · READING RECORD
          {recordId ? ` · ${recordId}` : ""}
          {specimen ? " · 示例，非真实患者" : ""}
        </span>
        <span className="sheet__id">
          {result.modelVersion ? `${result.modelVersion} · ` : ""}
          {formatTimestamp(result.createTime)}
        </span>
      </header>

      {rejected ? (
        <div className="sheet__section" style={{ borderTop: 0 }}>
          <div className="notice" data-tone="critical">
            <span className="notice__mark">拒识</span>
            <div>
              <p className="notice__title">本次影像未形成判读结论</p>
              <p className="notice__body">
                {result.abstainReason
                  ? `系统判定影像不足以支持判读：${result.abstainReason}。`
                  : "系统判定影像不足以支持判读。"}
                请重新上传清晰的眼底照片，或申请人工复核。
              </p>
            </div>
          </div>
          {/* 拒识不等于「不用复核」：算法在拒识时同样把记录置入人工复核队列。
              两个维度各自陈述，不能因为拒识就把复核状态藏起来。 */}
          <div className="sheet__facts">
            <div className="readout">
              <span className="readout__label">人工复核</span>
              <span className="readout__value">
                <RiskTag risk={review.risk}>{review.label}</RiskTag>
              </span>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="sheet__body">
            {imageSrc ? (
              <figure className="sheet__evidence">
                <img src={imageSrc} alt="本次判读的眼底照片" />
                <figcaption className="num">影像 · SOURCE</figcaption>
              </figure>
            ) : null}
            <div>
              <h2 className="sheet__verdict">
                {/* 判读源与分类码是结论的一部分，和病名同一个标题元素里读完，
                    不再压一条微型眉线在标题上方。 */}
                <span className="sheet__verdict-prefix">
                  AI 判读结果 · {classCode(verdict)}
                </span>
                {verdict ?? "未给出判读结果"}
              </h2>
              {result.details ? <p className="sheet__note">{result.details}</p> : null}

              <div className="sheet__facts">
                <div className="readout">
                  <span className="readout__label">置信度</span>
                  <span className="readout__value readout__value--mono">
                    {confidencePercent(confidence)}{" "}
                    <RiskTag risk={band.risk}>{band.label}</RiskTag>
                  </span>
                </div>
                <div className="readout">
                  <span className="readout__label">严重程度</span>
                  <span className="readout__value">
                    {severityLabel(result.severity)} ·{" "}
                    <RiskTag risk={stampRisk}>
                      {stampRisk === "normal"
                        ? "低"
                        : stampRisk === "attention"
                          ? "关注"
                          : stampRisk === "critical"
                            ? "高"
                            : "—"}
                    </RiskTag>
                  </span>
                </div>
                <div className="readout">
                  <span className="readout__label">人工复核</span>
                  <span className="readout__value">
                    <RiskTag risk={review.risk}>{review.label}</RiskTag>
                  </span>
                </div>
              </div>
            </div>

            <ConfidenceDial value={confidence} size={104} label="置信度" unit="CONF" />
          </div>

          {result.humanResult ? (
            <section className="sheet__section" data-review="human">
              <div className="sheet__section-head">
                <span className="overline">人工复核结论 · HUMAN REVIEW</span>
                {result.humanSeverity ? (
                  <span className="overline">
                    严重程度 ·{" "}
                    <RiskTag risk={severityRisk(result.humanSeverity)}>
                      {severityLabel(result.humanSeverity)}
                    </RiskTag>
                  </span>
                ) : null}
              </div>
              <p className="sheet__verdict">{result.humanResult}</p>
              {result.humanRecommendations ? (
                <ol className="recos">
                  {result.humanRecommendations
                    .split("\n")
                    .filter(Boolean)
                    .map((line) => (
                      <li key={line}>
                        <span className="recos__body">{line}</span>
                      </li>
                    ))}
                </ol>
              ) : null}
              {result.humanReviewNote ? (
                <p className="sheet__note">{result.humanReviewNote}</p>
              ) : null}
            </section>
          ) : null}

          {source ? (
            <section className="sheet__section" data-provenance="record">
              <div className="sheet__section-head">
                <span className="overline">来源与授权 · PROVENANCE</span>
                <span className="overline">只读</span>
              </div>
              {source.recordSource ? (
                <>
                  <div className="sheet__facts">
                    <div className="readout">
                      <span className="readout__label">记录来源</span>
                      <span className="readout__value">{recordSourceLabel(source.recordSource)}</span>
                    </div>
                    <div className="readout">
                      <span className="readout__label">草稿审核</span>
                      <span className="readout__value">
                        {draftReviewLabel(source.draftReviewState) ??
                          (source.recordSource === "COLLABORATION_DRAFT" ? "未记录" : "—")}
                      </span>
                    </div>
                    <div className="readout">
                      <span className="readout__label">患者授权</span>
                      <span className="readout__value">
                        {source.recordSource === "DIRECT" && !source.authorizationState
                          ? "本人上传，无需授权"
                          : authorizationLabel(
                              source.authorizationState,
                              source.authorizedAt,
                              source.authorizationReceipt,
                            )}
                      </span>
                    </div>
                    <div className="readout">
                      <span className="readout__label">复核人角色</span>
                      <span className="readout__value readout__value--mono">
                        {reviewerRoleLabel(source.reviewerRole)}
                      </span>
                    </div>
                    <div className="readout">
                      <span className="readout__label">影像</span>
                      <span className="readout__value">{archivalLabel(source.imageArchivalState)}</span>
                    </div>
                  </div>
                  <p className="sheet__note">
                    复核人角色取自账号，系统内没有可核验的执业资质数据；角色不等于临床资质证明。
                    患者授权保存只表示同意保存这份材料，不表示已完成临床复核。
                  </p>
                </>
              ) : (
                // 投影带回来了但内容读不出（后端查询失败时下发全空 + UNKNOWN 的 source）：
                // 这时说「无授权记录」「未记录」就是编事实——只能说读不到。
                <p className="sheet__note">
                  来源与授权这次没有读到：无法确认这条记录来自本人上传还是协作草稿，也无法确认是否经过患者授权。
                  「读不到」不等于「没有」，刷新后可再试。
                </p>
              )}
            </section>
          ) : null}

          <section className="sheet__section">
            <div className="sheet__section-head">
              <span className="overline">类别概率 · CLASS PROBABILITY</span>
              <span className="overline">0 — 100%</span>
            </div>
            <ClassScale rows={rows} />
          </section>

          {recos.length > 0 ? (
            <section className="sheet__section">
              <div className="sheet__section-head">
                <span className="overline">建议 · RECOMMENDATIONS</span>
              </div>
              <ol className="recos">
                {recos.map((line) => (
                  <li key={line} data-urgent={isUrgentAdvice(line) ? "true" : undefined}>
                    <span className="recos__body">
                      {isUrgentAdvice(line) ? (
                        <span className="recos__flag">急</span>
                      ) : null}
                      {line}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : (
            <section className="sheet__section">
              <div className="sheet__section-head">
                <span className="overline">建议 · RECOMMENDATIONS</span>
              </div>
              <div className="notice" data-tone="attention">
                <span className="notice__mark">提示</span>
                <div>
                  <p className="notice__title">本次判读未给出个体化建议</p>
                  <p className="notice__body">{TRIAGE_FALLBACK}</p>
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {result.requiresReview ? (
        <section className="sheet__section">
          <div className="notice" data-tone="attention">
            <span className="notice__mark">待复核</span>
            <div>
              <p className="notice__title">
                {rejected ? "该影像已转入人工复核" : "AI 初步判读待人工复核"}
              </p>
              <p className="notice__body">
                {rejected
                  ? "模型未给出结论，记录已进入人工复核队列；复核完成前不构成诊断。"
                  : "该记录已进入人工复核队列，签字前不得作为诊疗依据引用。"}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <div className="sheet__stamps">
        {/* 记录存在 ≠ 影像已归档：这两个事实分开陈述，不能让「有报告」暗示「原图可追溯」。
            注：修复前（commit 46628563 之前）写入的历史记录可能没有影像——那时后端把
            对象存储异常吞掉照样落库；现在存储失败会终止请求、不落库，所以「未归档」
            主要出现在历史数据上。 */}
        {!specimen ? (
          <div className="sheet__stamp">
            <div className="readout">
              <span className="readout__label">原始影像</span>
              <span className="readout__value">
                {archival === "archived" ? (
                  <span className="num">已归档</span>
                ) : archival === "restricted" ? (
                  <span className="num">已归档 · 不公开地址</span>
                ) : archival === "unknown" ? (
                  <span className="num">无法确认</span>
                ) : (
                  <RiskTag risk="attention">未归档</RiskTag>
                )}
              </span>
            </div>
          </div>
        ) : null}
        <div className="sheet__stamp">
          <div className="readout">
            <span className="readout__label">质量门</span>
            <span className="readout__value">
              {rejected ? (
                <RiskTag risk="critical">未通过</RiskTag>
              ) : (
                <span className="num">
                  {typeof result.qualityScore === "number"
                    ? `通过 · ${Math.round(result.qualityScore)}`
                    : "通过"}
                </span>
              )}
            </span>
          </div>
        </div>
        <div className="sheet__stamp">
          <div className="readout">
            <span className="readout__label">人工复核</span>
            <span className="readout__value">
              <RiskTag risk={review.risk}>{review.label}</RiskTag>
            </span>
          </div>
        </div>
        <div className="sheet__stamp">
          <div className="readout">
            <span className="readout__label">模型</span>
            <span className="readout__value readout__value--mono">
              {result.modelVersion ?? "—"}
            </span>
          </div>
        </div>
        <div className="sheet__stamp">
          <div className="readout">
            <span className="readout__label">权重 SHA-256</span>
            <span className="readout__value readout__value--mono">
              {shortHash(result.weightSha256)}
            </span>
          </div>
        </div>
      </div>

      <div className="disclaimer">
        <p>
          {result.disclaimer ||
            "本记录由 AI 辅助判读生成，仅供参考，不构成诊断结论，不能替代执业医师的检查与判断。"}
          {archival === "missing" && !specimen
            ? "模型版本与权重指纹随记录保存；本次原始影像未成功归档，复核时无法回放原图。"
            : archival === "restricted"
              ? "模型版本与权重指纹随记录保存；影像已归档，按隐私策略不公开地址。"
              : archival === "unknown"
                ? "模型版本与权重指纹随记录保存；本次影像的归档状态暂时无法确认。"
                : "影像、模型版本与权重指纹随记录保存，可在复核时回放。"}
        </p>
      </div>

      {actions && !specimen ? <div className="sheet__actions no-print">{actions}</div> : null}
    </article>
  )
}