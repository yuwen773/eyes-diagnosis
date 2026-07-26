package com.csust.eyediagnosis.workflow.job;

public interface WorkflowJobCreationService {
    JobCreationResult createIfAbsent(NewWorkflowJob job);
}
