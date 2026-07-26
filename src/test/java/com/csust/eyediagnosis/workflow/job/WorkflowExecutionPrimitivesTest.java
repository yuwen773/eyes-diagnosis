package com.csust.eyediagnosis.workflow.job;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class WorkflowExecutionPrimitivesTest {

    @Test
    void propertiesRejectInvalidLeaseRetryAndRecoveryValues() {
        assertThrows(IllegalArgumentException.class, () -> new WorkflowExecutionProperties(false, Duration.ZERO, Duration.ofSeconds(1), Duration.ofSeconds(1), 1));
        assertThrows(IllegalArgumentException.class, () -> new WorkflowExecutionProperties(false, Duration.ofSeconds(1), Duration.ZERO, Duration.ofSeconds(1), 1));
        assertThrows(IllegalArgumentException.class, () -> new WorkflowExecutionProperties(false, Duration.ofSeconds(1), Duration.ofSeconds(2), Duration.ofSeconds(1), 1));
        assertThrows(IllegalArgumentException.class, () -> new WorkflowExecutionProperties(false, Duration.ofSeconds(1), Duration.ofSeconds(1), Duration.ofSeconds(1), 0));
    }

    @Test
    void backoffIsExponentialCappedAndRejectsInvalidAttempts() {
        JobRetryBackoffPolicy policy = new ExponentialJobRetryBackoffPolicy(Duration.ofSeconds(5), Duration.ofSeconds(20));

        assertEquals(Duration.ofSeconds(5), policy.delayForAttempt(1));
        assertEquals(Duration.ofSeconds(10), policy.delayForAttempt(2));
        assertEquals(Duration.ofSeconds(20), policy.delayForAttempt(3));
        assertEquals(Duration.ofSeconds(20), policy.delayForAttempt(9));
        assertThrows(IllegalArgumentException.class, () -> policy.delayForAttempt(0));
    }

    @Test
    void tokenGeneratorProducesNonEmptyDistinctTokens() {
        LeaseTokenGenerator generator = new UuidLeaseTokenGenerator();
        Set<String> tokens = new HashSet<>();
        for (int index = 0; index < 256; index++) {
            String token = generator.generate();
            assertFalse(token.isBlank());
            assertTrue(tokens.add(token));
        }
    }

    @Test
    void disabledGatePreventsOnlyNewClaimsAndRecovery() {
        WorkflowExecutionGate gate = new PropertiesWorkflowExecutionGate(
                new WorkflowExecutionProperties(false, Duration.ofSeconds(30), Duration.ofSeconds(5), Duration.ofMinutes(1), 10));

        assertFalse(gate.isClaimEnabled());
    }
}
