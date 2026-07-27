package com.csust.eyediagnosis.workflow.api;

import com.csust.eyediagnosis.workflow.policy.WorkflowLifecycleGuard;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * PR-10 wiring for the API gateway. The frozen {@link WorkflowLifecycleGuard} (PR-04) is a plain
 * stateless class instantiated directly by the runtime — it is exposed here as a bean for the
 * API-side command orchestration without touching the frozen policy package.
 */
@Configuration
public class WorkflowApiConfiguration {

    @Bean
    public WorkflowLifecycleGuard workflowLifecycleGuard() {
        return new WorkflowLifecycleGuard();
    }
}
