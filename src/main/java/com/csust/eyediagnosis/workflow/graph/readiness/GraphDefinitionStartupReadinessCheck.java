package com.csust.eyediagnosis.workflow.graph.readiness;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** Fails application startup before any future graph worker can become ready. */
@Component
@ConditionalOnProperty(prefix = "workflow.graph", name = "readiness-check-enabled", havingValue = "true", matchIfMissing = true)
public class GraphDefinitionStartupReadinessCheck implements ApplicationRunner {
    private final GraphDefinitionReadinessVerifier verifier;

    public GraphDefinitionStartupReadinessCheck(GraphDefinitionReadinessVerifier verifier) { this.verifier = verifier; }

    @Override public void run(ApplicationArguments args) { verifier.verifyNonTerminalWorkflows(); }
}
