package com.csust.eyediagnosis.collaboration;

import com.csust.eyediagnosis.controlledreference.ControlledEvidenceRetriever;
import com.csust.eyediagnosis.patientdraft.PatientDraftCoordinator;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** A separate JVM can replay durable facts and decrypt the cursor without calling any model. */
public class CollaborationReplayWorker {
    public static void main(String[] args) throws Exception {
        String url = System.getenv("COLLABORATION_TEST_URL");
        if (url == null || !url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/collaboration_test")) throw new IllegalArgumentException();
        var jdbc = new JdbcTemplate(new DriverManagerDataSource(url, "collaboration", "collaboration"));
        try (var coordinator = new PatientDraftCoordinator(jdbc, new ControlledEvidenceRetriever(jdbc), prompt -> { throw new AssertionError("Replay must not call the model"); });
             var runs = new CollaborationRunService(jdbc, new CollaborationEvents(jdbc), new CollaborationCursor("03".repeat(32)), coordinator)) {
            CollaborationRunTest.enableFixture(runs);
            var subscription = runs.subscribe(args[0], 42, args[1], null);
            var batch = runs.read(subscription, subscription.sequence());
            System.out.println("TASK03_REPLAY=" + new ObjectMapper().findAndRegisterModules().writeValueAsString(batch.frames().stream().map(CollaborationRunService.Frame::event).toList()));
        }
    }
}
