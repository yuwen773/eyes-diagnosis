package com.csust.eyediagnosis.workflow.job;

public record ExpiredLeaseRecoveryReport(boolean skipped, int retried, int failed, int cancelled) {
    static ExpiredLeaseRecoveryReport skippedReport() {
        return new ExpiredLeaseRecoveryReport(true, 0, 0, 0);
    }
}
