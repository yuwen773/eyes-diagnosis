package com.csust.eyediagnosis.workflow.graph.readiness;

import com.csust.eyediagnosis.workflow.graph.exception.GraphRuntimeNotReadyException;
import org.junit.jupiter.api.Test;
import org.springframework.boot.DefaultApplicationArguments;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class GraphDefinitionStartupReadinessCheckTest {
    @Test
    void delegatesToReadinessVerifierAndPropagatesFailures() {
        assertDoesNotThrow(() -> new GraphDefinitionStartupReadinessCheck(() -> new GraphDefinitionReadinessReport(0, Set.of()))
                .run(new DefaultApplicationArguments()));
        assertThrows(GraphRuntimeNotReadyException.class, () -> new GraphDefinitionStartupReadinessCheck(() -> {
            throw new GraphRuntimeNotReadyException(1, 0, 0, java.util.List.of("workflow"));
        }).run(new DefaultApplicationArguments()));
    }
}
