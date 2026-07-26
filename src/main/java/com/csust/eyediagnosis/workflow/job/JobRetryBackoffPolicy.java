package com.csust.eyediagnosis.workflow.job;

import java.time.Duration;

public interface JobRetryBackoffPolicy {
    Duration delayForAttempt(int attempt);
}
