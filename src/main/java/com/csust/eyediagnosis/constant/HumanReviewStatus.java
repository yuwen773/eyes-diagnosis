package com.csust.eyediagnosis.constant;

/**
 * 人工复审状态枚举。
 *
 * <ul>
 *   <li>PENDING_AI — 尚未有 AI 输出</li>
 *   <li>AI_ONLY — 仅 AI 结论,等待人工复核</li>
 *   <li>AWAITING_REVIEW — 触发了拒识/低置信度,等待人工复核</li>
 *   <li>REVIEWED — 医生已完成人工复核</li>
 *   <li>OVERRIDDEN — 医生结论已推翻 AI 结论</li>
 * </ul>
 */
public interface HumanReviewStatus {
    String PENDING_AI = "PENDING_AI";
    String AI_ONLY = "AI_ONLY";
    String AWAITING_REVIEW = "AWAITING_REVIEW";
    String REVIEWED = "REVIEWED";
    String OVERRIDDEN = "OVERRIDDEN";
}