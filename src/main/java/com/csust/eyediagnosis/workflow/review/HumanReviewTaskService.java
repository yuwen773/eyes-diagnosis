package com.csust.eyediagnosis.workflow.review;

/** Doctor-facing review task actions; the graph itself is never run here. */
public interface HumanReviewTaskService {
    void claim(ClaimReviewTaskCommand command);

    ReviewSubmissionResult submit(SubmitReviewDecisionCommand command);

    void cancel(String reviewTaskId, long expectedTaskVersion);
}
