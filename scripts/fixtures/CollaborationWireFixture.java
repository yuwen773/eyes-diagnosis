import com.csust.eyediagnosis.collaboration.CollaborationRunService;
import com.csust.eyediagnosis.config.JsonConfig;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;

import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.ArrayList;

/** Export synthetic DTOs through the actual TASK-03 application mapper, without a database or model. */
public class CollaborationWireFixture {
    public static void main(String[] args) throws Exception {
        var mapper = new JsonConfig().jacksonObjectMapper(new Jackson2ObjectMapperBuilder());
        JsonNode fixture = mapper.readTree(Path.of(args[0]).toFile());
        var snapshot = new CollaborationRunService.Snapshot("run-a", "task-a", "thread-a", "COORDINATOR",
                "AUTONOMOUS_V2", "ACCEPTED", "NOT_SUBMITTED", null, Map.of(), 1L, "opaque-snapshot", "v1:patient");
        var events = new ArrayList<CollaborationRunService.Event>();
        long sequence = 1;
        for (JsonNode sample : fixture.get("events")) {
            events.add(new CollaborationRunService.Event("run-a:" + sequence, 1, "run-a", "thread-a", sequence,
                    Instant.parse("2026-11-11T12:00:00Z"), sample.get("type").asText(), sample.get("actor").asText(),
                    sample.get("visibility").asText(), sample.get("payload")));
            sequence++;
        }
        mapper.writerWithDefaultPrettyPrinter().writeValue(Path.of(args[1]).toFile(), Map.of(
                "evidenceType", "REAL_JACKSON_SYNTHETIC_DTO", "snapshot", snapshot, "events", List.copyOf(events)));
    }
}
