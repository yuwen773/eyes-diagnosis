package com.csust.eyediagnosis.poc.realtime;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.prompt.Prompt;

import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** B1 fault-injection suite: zero network, zero real model, zero patient data. */
class FormatOnlyRetryPocTest {

    /** Strict creator schema; missing/duplicate/trailing JSON all produce JsonProcessingException. */
    record Answer(String query) {
        @JsonCreator
        Answer(@JsonProperty("query") String query) { this.query = query; }
    }

    private static final FormatOnlyRetryPoc.AttemptSpec SPEC = new FormatOnlyRetryPoc.AttemptSpec(
            "call-1", "task-1", "EVIDENCE", "Produce a controlled search query.",
            Map.of("inference", "synthetic", "evidenceVersion", 3), 3, "GRAPH_V1", 7L);

    private static FormatOnlyRetryPoc poc(FormatOnlyRetryPoc.ScriptedModel model,
                                          FormatOnlyRetryPoc.Ledger ledger, boolean enabled) {
        return new FormatOnlyRetryPoc(model, ledger, enabled, 90_000L, () -> false, () -> 0L);
    }

    @Test
    void defaultOffNeverIssuesASecondCallEvenOnFormatJitter() {
        var model = new FormatOnlyRetryPoc.ScriptedModel().then("not json").then("{\"query\":\"glaucoma\"}");
        var ledger = new FormatOnlyRetryPoc.Ledger(8, 7L);

        assertThrows(com.fasterxml.jackson.core.JsonProcessingException.class,
                () -> poc(model, ledger, false).ask(SPEC, Answer.class));
        assertEquals(1, model.calls(), "default-off must preserve maxAttempts(1)");
        assertEquals(1, ledger.chargedCount(), "the one real attempt is charged");
    }

    @Test
    void enabledRetriesExactlyOnceAndPreservesTheWholeAttemptIdentity() throws Exception {
        var model = new FormatOnlyRetryPoc.ScriptedModel().then("{oops").then("{\"query\":\"glaucoma\"}");
        var ledger = new FormatOnlyRetryPoc.Ledger(8, 7L);

        Answer answer = poc(model, ledger, true).ask(SPEC, Answer.class);

        assertEquals("glaucoma", answer.query());
        assertEquals(2, model.calls(), "one original + at most one extra format-only attempt");
        assertEquals(2, ledger.chargedCount(), "both real attempts are in the unified budget");
        assertSamePrompt(model.prompts().get(0), model.prompts().get(1),
                "role, instructions, context, evidence version and task must not change");
    }

    @Test
    void twoFormatFailuresStopAtTheSecondAttemptWithoutAThirdCall() {
        var model = new FormatOnlyRetryPoc.ScriptedModel()
                .then("{oops").then("{\"query\":\"glaucoma\"} trailing")
                .then("{\"query\":\"third\"}");
        var ledger = new FormatOnlyRetryPoc.Ledger(8, 7L);

        assertThrows(com.fasterxml.jackson.core.JsonProcessingException.class,
                () -> poc(model, ledger, true).ask(SPEC, Answer.class));
        assertEquals(2, model.calls());
        assertEquals(2, ledger.chargedCount());
    }

    @Test
    void nonFormatTerminalFaultsNeverTriggerASecondCall() {
        for (var fault : List.of(FormatOnlyRetryPoc.Fault.PROVIDER, FormatOnlyRetryPoc.Fault.TIMEOUT,
                FormatOnlyRetryPoc.Fault.SAFETY, FormatOnlyRetryPoc.Fault.INSUFFICIENT_CITATION,
                FormatOnlyRetryPoc.Fault.FORMAT_SCHEMA, FormatOnlyRetryPoc.Fault.RESPONSE_SHAPE)) {
            var model = new FormatOnlyRetryPoc.ScriptedModel()
                    .thenFault(fault).then("{\"query\":\"should-not-be-consumed\"}");
            var ledger = new FormatOnlyRetryPoc.Ledger(8, 7L);

            var thrown = assertThrows(FormatOnlyRetryPoc.PocFault.class,
                    () -> poc(model, ledger, true).ask(SPEC, Answer.class));
            assertEquals(fault, thrown.fault(), fault + " must be terminal");
            assertEquals(1, model.calls(), fault + " must not retry");
            assertEquals(1, ledger.chargedCount());
        }
    }

    @Test
    void malformedJsonOutputNeverChangesCriticFeedbackBudget() {
        var critic = new FormatOnlyRetryPoc.AttemptSpec("call-2", "task-1", "CRITIC",
                "Independently check the draft.", SPEC.context(), 3, "GRAPH_V1", 7L);
        var model = new FormatOnlyRetryPoc.ScriptedModel().then("{oops").then("{\"action\":\"NONE\"}");
        var ledger = new FormatOnlyRetryPoc.Ledger(8, 7L);

        assertThrows(com.fasterxml.jackson.core.JsonProcessingException.class,
                () -> poc(model, ledger, true).ask(critic, Map.class));
        assertEquals(1, model.calls(), "Critic feedback budget is a separate frozen contract");
    }

    @Test
    void budgetFencingCancellationAndDeadlineBlockTheExtraAttempt() {
        var smallBudget = new FormatOnlyRetryPoc.Ledger(1, 7L);
        var model1 = new FormatOnlyRetryPoc.ScriptedModel().then("{oops").then("{\"query\":\"x\"}");
        var blocked1 = assertThrows(FormatOnlyRetryPoc.RetryBlocked.class,
                () -> poc(model1, smallBudget, true).ask(SPEC, Answer.class));
        assertEquals("CALL_BUDGET", blocked1.reason());
        assertEquals(1, model1.calls());

        var ledger2 = new FormatOnlyRetryPoc.Ledger(8, 7L);
        var model2 = new FormatOnlyRetryPoc.ScriptedModel()
                .then("{oops").then("{\"query\":\"x\"} trailing");
        var now = new AtomicLong(90_001L);
        var poc2 = new FormatOnlyRetryPoc(model2, ledger2, true, 90_000L, () -> false, now::get);
        var blocked2 = assertThrows(FormatOnlyRetryPoc.RetryBlocked.class,
                () -> poc2.ask(SPEC, Answer.class));
        assertEquals("TOTAL_TIMEOUT", blocked2.reason());
        assertEquals(0, model2.calls(), "the deadline is checked before the first charge");

        var ledger2b = new FormatOnlyRetryPoc.Ledger(8, 7L);
        var model2b = new FormatOnlyRetryPoc.ScriptedModel()
                .then("{oops").then("{\"query\":\"x\"}");
        var advancing = new AtomicLong(0L);
        var blocked2b = assertThrows(FormatOnlyRetryPoc.RetryBlocked.class,
                () -> new FormatOnlyRetryPoc(model2b, ledger2b, true, 90_000L,
                        () -> false, () -> advancing.getAndAdd(90_001L)).ask(SPEC, Answer.class));
        assertEquals("TOTAL_TIMEOUT", blocked2b.reason(),
                "the deadline also blocks the extra attempt after a parse failure");
        assertEquals(1, model2b.calls());
        assertEquals(1, ledger2b.chargedCount());

        var ledger3 = new FormatOnlyRetryPoc.Ledger(8, 7L);
        var model3 = new FormatOnlyRetryPoc.ScriptedModel().then("{oops").then("{\"query\":\"x\"}");
        // Cancellation becomes visible after the first real call, before the retry charge.
        var poc3 = new FormatOnlyRetryPoc(model3, ledger3, true, 90_000L,
                () -> model3.calls() > 0, () -> 0L);
        var blocked3 = assertThrows(FormatOnlyRetryPoc.RetryBlocked.class,
                () -> poc3.ask(SPEC, Answer.class));
        assertEquals("CANCELLED", blocked3.reason());
        assertEquals(1, model3.calls(), "no extra call after cancellation");
        assertEquals(1, ledger3.chargedCount());

        var ledger4 = new FormatOnlyRetryPoc.Ledger(8, 7L);
        ledger4.bumpFence(8L);
        var model4 = new FormatOnlyRetryPoc.ScriptedModel().then("{\"query\":\"x\"}");
        var blocked4 = assertThrows(FormatOnlyRetryPoc.RetryBlocked.class,
                () -> poc(model4, ledger4, true).ask(SPEC, Answer.class));
        assertEquals("FENCING_MISMATCH", blocked4.reason());
        assertEquals(0, model4.calls(), "a stale lease must not reach the provider");
    }

    @Test
    void recoveryAfterChargedButUncommittedCallDoesNotDispatchAgain() {
        var ledger = new FormatOnlyRetryPoc.Ledger(8, 7L);
        var firstProcessModel = new FormatOnlyRetryPoc.ScriptedModel().thenCrash();
        assertThrows(FormatOnlyRetryPoc.ProcessCrash.class,
                () -> poc(firstProcessModel, ledger, true).ask(SPEC, Answer.class));
        assertEquals(1, ledger.chargedCount());
        assertEquals(1, ledger.pendingChargedCount());

        // A fresh "process" reuses the same durable ledger and the same logical call id.
        var resumedModel = new FormatOnlyRetryPoc.ScriptedModel().then("{\"query\":\"x\"}");
        var blocked = assertThrows(FormatOnlyRetryPoc.RetryBlocked.class,
                () -> poc(resumedModel, ledger, true).ask(SPEC, Answer.class));
        assertEquals("RECOVERY_PENDING", blocked.reason());
        assertEquals(0, resumedModel.calls(), "no duplicate model call after recovery");
        assertEquals(1, ledger.chargedCount(), "recovery does not double-charge the budget");
    }

    @Test
    void committedResultIsReplayedWithoutAnotherModelCall() throws Exception {
        var ledger = new FormatOnlyRetryPoc.Ledger(8, 7L);
        var first = new FormatOnlyRetryPoc.ScriptedModel().then("{\"query\":\"glaucoma\"}");
        assertEquals("glaucoma", poc(first, ledger, true).ask(SPEC, Answer.class).query());
        assertEquals(1, first.calls());

        var replayModel = new FormatOnlyRetryPoc.ScriptedModel().then("{\"query\":\"other\"}");
        assertEquals("glaucoma", poc(replayModel, ledger, true).ask(SPEC, Answer.class).query());
        assertEquals(0, replayModel.calls(), "committed attempt is idempotent, not re-dispatched");
        assertEquals(1, ledger.chargedCount());
    }

    @Test
    void formatOnlyClassificationRejectsEveryTerminalFault() {
        for (var fault : FormatOnlyRetryPoc.Fault.values()) {
            assertTrue(!FormatOnlyRetryPoc.isFormatOnly(new FormatOnlyRetryPoc.PocFault(fault)));
        }
        assertTrue(FormatOnlyRetryPoc.isFormatOnly(
                assertInstanceOf(com.fasterxml.jackson.core.JsonProcessingException.class,
                        assertThrows(com.fasterxml.jackson.core.JsonProcessingException.class,
                                () -> new com.fasterxml.jackson.databind.ObjectMapper()
                                        .readValue("{oops", Map.class)))));
    }

    private static void assertSamePrompt(Prompt a, Prompt b, String message) {
        assertEquals(a.getSystemMessage().getText(), b.getSystemMessage().getText(), message);
        assertEquals(a.getUserMessage().getText(), b.getUserMessage().getText(), message);
        assertEquals(a.getOptions().getClass(), b.getOptions().getClass(), message);
    }
}
