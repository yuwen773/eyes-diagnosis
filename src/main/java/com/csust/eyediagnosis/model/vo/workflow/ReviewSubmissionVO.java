package com.csust.eyediagnosis.model.vo.workflow;

import lombok.Data;

import java.io.Serializable;

/**
 * Result of a successful review submission, mirroring {@code ReviewSubmissionResult}.
 */
@Data
public class ReviewSubmissionVO implements Serializable {
    private String taskId;
    private String workflowId;
    private long committedWorkflowVersion;
    private String resumeJobId;
}
