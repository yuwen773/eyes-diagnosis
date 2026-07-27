package com.csust.eyediagnosis.workflow.review;

/** Atomic outcome of one accepted review decision submission. */
public record ReviewSubmissionResult(String reviewTaskId, String workflowId, long committedWorkflowVersion,
                                     String resumeJobId) {
}
