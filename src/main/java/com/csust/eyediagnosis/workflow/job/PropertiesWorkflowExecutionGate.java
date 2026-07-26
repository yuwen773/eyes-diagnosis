package com.csust.eyediagnosis.workflow.job;

import org.springframework.stereotype.Component;

@Component
public class PropertiesWorkflowExecutionGate implements WorkflowExecutionGate {
    private final WorkflowExecutionProperties properties;

    public PropertiesWorkflowExecutionGate(WorkflowExecutionProperties properties) {
        this.properties = properties;
    }

    @Override
    public boolean isClaimEnabled() {
        return properties.enabled();
    }
}
