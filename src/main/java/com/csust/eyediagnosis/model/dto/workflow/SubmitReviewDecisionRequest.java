package com.csust.eyediagnosis.model.dto.workflow;

import lombok.Data;

import java.io.Serializable;

/**
 * Body for {@code POST /api/reviews/tasks/{taskId}/submit}.
 * Only {@code decision} is part of the frozen contract; {@code comment} is accepted for the
 * clinician's notes (recorded where the review service supports it).
 */
@Data
public class SubmitReviewDecisionRequest implements Serializable {
    private String decision;
    private String comment;
}
