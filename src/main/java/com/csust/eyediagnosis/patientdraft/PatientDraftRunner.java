package com.csust.eyediagnosis.patientdraft;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Explicit opt-in because enabling this worker sends minimized inference context to the configured model provider. */
@Component
@ConditionalOnProperty(name = "eye-diagnosis.draft.enabled", havingValue = "true")
public class PatientDraftRunner {
    private static final Logger log = LoggerFactory.getLogger(PatientDraftRunner.class);
    private final PatientDraftCoordinator coordinator;
    private final java.util.concurrent.ExecutorService executor = java.util.concurrent.Executors.newSingleThreadExecutor(r -> {
        var thread = new Thread(r, "patient-draft-worker"); thread.setDaemon(true); return thread;
    });
    private final java.util.concurrent.atomic.AtomicBoolean running = new java.util.concurrent.atomic.AtomicBoolean();

    public PatientDraftRunner(PatientDraftCoordinator coordinator) { this.coordinator = coordinator; }

    @Scheduled(fixedDelayString = "${eye-diagnosis.draft.poll-ms:5000}")
    public void schedule() {
        if (!running.compareAndSet(false, true)) return;
        try {
            executor.execute(() -> {
                try { coordinator.runPendingOnce(); }
                catch (Exception e) { log.error("Patient draft polling failed", e); }
                finally { running.set(false); }
            });
        } catch (java.util.concurrent.RejectedExecutionException e) { running.set(false); }
    }

    @jakarta.annotation.PreDestroy
    public void shutdown() { executor.shutdownNow(); }
}
