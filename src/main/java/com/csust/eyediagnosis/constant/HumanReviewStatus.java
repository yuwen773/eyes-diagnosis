package com.csust.eyediagnosis.constant;

/**
 * 人工复审状态枚举。
 *
 * <ul>
 *   <li>PENDING_AI — 尚未有 AI 输出</li>
 *   <li>AI_ONLY — 仅 AI 结论，**没有进入复核队列**（没有复核请求被派出去）</li>
 *   <li>AWAITING_REVIEW — 触发了拒识/低置信度，已进入复核队列，等待人工复核</li>
 *   <li>REVIEWED — 复核人已完成人工复核。**不复述复核人是不是医生**：
 *       写入方（{@code recordHumanReview}）只校验 `admin` 角色，本系统没有可核验的
 *       临床资质数据源。要知道是谁做的，看 `humanReviewerId` 与 `t_diagnosis_audit` 的
 *       `actorRole`。</li>
 *   <li>OVERRIDDEN — 复核结论推翻了 AI 结论（同上，不等于「医生」）</li>
 * </ul>
 *
 * <p>D-01b 未决：管理员是否具备临床复核资格需要医学负责人确认。在此之前，
 * 任何展示层都不得把 REVIEWED 写成「医生复核」。
 */
public interface HumanReviewStatus {
    String PENDING_AI = "PENDING_AI";
    String AI_ONLY = "AI_ONLY";
    String AWAITING_REVIEW = "AWAITING_REVIEW";
    String REVIEWED = "REVIEWED";
    String OVERRIDDEN = "OVERRIDDEN";
}