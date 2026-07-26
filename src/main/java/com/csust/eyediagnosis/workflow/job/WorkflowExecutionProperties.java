package com.csust.eyediagnosis.workflow.job;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.Objects;

@ConfigurationProperties(prefix = "workflow.execution")
public record WorkflowExecutionProperties(
        boolean enabled,
        Duration leaseDuration,
        Duration retryInitialDelay,
        Duration retryMaximumDelay,
        int recoveryBatchSize
) {
    public WorkflowExecutionProperties {
        Objects.requireNonNull(leaseDuration, "leaseDuration must not be null");
        Objects.requireNonNull(retryInitialDelay, "retryInitialDelay must not be null");
        Objects.requireNonNull(retryMaximumDelay, "retryMaximumDelay must not be null");
        if (leaseDuration.isZero() || leaseDuration.isNegative()) {
            throw new IllegalArgumentException("leaseDuration must be positive");
        }
        if (retryInitialDelay.isZero() || retryInitialDelay.isNegative()) {
            throw new IllegalArgumentException("retryInitialDelay must be positive");
        }
        if (retryMaximumDelay.compareTo(retryInitialDelay) < 0) {
            throw new IllegalArgumentException("retryMaximumDelay must not be smaller than retryInitialDelay");
        }
        if (recoveryBatchSize <= 0) {
            throw new IllegalArgumentException("recoveryBatchSize must be positive");
        }
    }
}
