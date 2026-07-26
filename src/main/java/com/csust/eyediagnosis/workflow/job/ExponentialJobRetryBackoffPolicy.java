package com.csust.eyediagnosis.workflow.job;

import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;

@Component
public class ExponentialJobRetryBackoffPolicy implements JobRetryBackoffPolicy {
    private final Duration initialDelay;
    private final Duration maximumDelay;

    @Autowired
    public ExponentialJobRetryBackoffPolicy(WorkflowExecutionProperties properties) {
        this(properties.retryInitialDelay(), properties.retryMaximumDelay());
    }

    ExponentialJobRetryBackoffPolicy(Duration initialDelay, Duration maximumDelay) {
        this.initialDelay = initialDelay;
        this.maximumDelay = maximumDelay;
    }

    @Override
    public Duration delayForAttempt(int attempt) {
        if (attempt <= 0) {
            throw new IllegalArgumentException("attempt must be positive");
        }
        Duration delay = initialDelay;
        for (int index = 1; index < attempt && delay.compareTo(maximumDelay) < 0; index++) {
            if (delay.compareTo(maximumDelay.dividedBy(2)) > 0) {
                return maximumDelay;
            }
            delay = delay.multipliedBy(2);
        }
        return delay.compareTo(maximumDelay) > 0 ? maximumDelay : delay;
    }
}
