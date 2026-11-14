package com.csust.eyediagnosis.patientdraft;

import com.csust.eyediagnosis.controlledreference.ControlledEvidenceRetriever;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** Separate JVM dies after the coordinator durably reserves its first provider call. */
public class PatientDraftCrashWorker {
    public static void main(String[] args) {
        String url = System.getenv("ISSUE19_TEST_URL");
        if (url == null || !url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/issue19_test")) throw new IllegalArgumentException();
        var jdbc = new JdbcTemplate(new DriverManagerDataSource(url, "issue19", "issue19"));
        var entered = new java.util.concurrent.CountDownLatch(2);
        ChatModel haltedProvider = prompt -> {
            entered.countDown();
            try { if (!entered.await(10, java.util.concurrent.TimeUnit.SECONDS)) throw new AssertionError("Both calls must be reserved"); }
            catch (InterruptedException e) { throw new AssertionError(e); }
            Runtime.getRuntime().halt(23); return null;
        };
        new PatientDraftCoordinator(jdbc, new ControlledEvidenceRetriever(jdbc), haltedProvider).run(args[0]);
        throw new AssertionError("The provider must have terminated this process");
    }
}
