package com.csust.eyediagnosis.model.vo.workflow;

import lombok.Data;

import java.io.Serializable;

/**
 * Summary of a pending human-review task returned by {@code GET /api/reviews/tasks}.
 * {@code reason} is the {@code reviewType} (e.g. FINAL_CLINICAL_REVIEW).
 */
@Data
public class ReviewTaskSummaryVO implements Serializable {
    private String taskId;
    private String workflowId;
    private String reason;
}
