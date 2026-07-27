package com.csust.eyediagnosis.model.dto.workflow;

import lombok.Data;

import java.io.Serializable;

@Data
public class WorkflowCreateResult implements Serializable {
    private String workflowId;
    private String status;
}
