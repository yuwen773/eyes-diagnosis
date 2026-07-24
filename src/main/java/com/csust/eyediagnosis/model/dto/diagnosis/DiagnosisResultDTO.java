package com.csust.eyediagnosis.model.dto.diagnosis;

import lombok.Data;

import java.io.Serializable;

/**
 * 人工复核 DTO：仅允许写入 humanResult / humanSeverity / humanRecommendations / humanReviewNote，
 * AI 字段（predictedLabel、probability、details、aiRejected 等）不可通过本 DTO 覆盖，
 * 防止管理员误把 AI 字段写错。
 *
 * @Author 钰玟
 * @Date 2026-07-23
 */
@Data
public class DiagnosisResultDTO implements Serializable {
    /**
     * id
     */
    private Long id;

    /**
     * 人工结论
     */
    private String humanResult;

    /**
     * 人工严重程度
     */
    private String humanSeverity;

    /**
     * 人工建议
     */
    private String humanRecommendations;

    /**
     * 人工备注
     */
    private String humanReviewNote;

    private static final long serialVersionUID = 1L;
}