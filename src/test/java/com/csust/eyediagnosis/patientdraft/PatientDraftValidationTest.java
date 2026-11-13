package com.csust.eyediagnosis.patientdraft;

import com.csust.eyediagnosis.controlledreference.ControlledEvidenceRetriever.Citation;
import com.csust.eyediagnosis.patientdraft.DraftAgents.Claim;
import com.csust.eyediagnosis.patientdraft.DraftAgents.Draft;
import com.csust.eyediagnosis.patientdraft.DraftAgents.Reference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** Offline guard for the two safety-critical decisions: grounded draft acceptance and fault classification. */
class PatientDraftValidationTest {
    private static final String QUOTE = "单元测试";
    private static final Citation CITATION = new Citation(
            "doc-1", "标题", "来源", "v1", 1L, 0,
            "本示例仅用于单元测试的引用摘录。", "digest", "APPROVED", 1L,
            Instant.parse("2026-11-12T00:00:00Z"));
    private static final PatientDraftCoordinator.Evidence FROZEN =
            new PatientDraftCoordinator.Evidence(1, List.of(CITATION));
    private static final List<String> SECTIONS =
            List.of("MAIN_FINDING", "RISK", "NEXT_STEP", "UNCERTAINTY", "DETAIL", "LIMITATION");

    private static List<Claim> claims() {
        var references = List.of(new Reference(0, QUOTE));
        var out = new ArrayList<Claim>();
        for (int i = 0; i < SECTIONS.size(); i++)
            out.add(new Claim("c" + (i + 1), SECTIONS.get(i), "text", references));
        return out;
    }

    @Test
    void acceptsAWellFormedDraft() {
        PatientDraftCoordinator.validateDraft(new Draft(1, claims()), FROZEN);
    }

    @Test
    void rejectsMismatchedEvidenceVersion() {
        assertEquals("INVALID_OUTPUT", stopReason(() ->
                PatientDraftCoordinator.validateDraft(new Draft(2, claims()), FROZEN)));
    }

    @Test
    void rejectsAMissingSection() {
        var claims = claims();
        claims.remove(claims.size() - 1);
        assertEquals("INVALID_OUTPUT", stopReason(() ->
                PatientDraftCoordinator.validateDraft(new Draft(1, claims), FROZEN)));
    }

    @Test
    void rejectsDuplicateClaimIds() {
        var claims = claims();
        claims.set(1, new Claim("c1", "RISK", "text", List.of(new Reference(0, QUOTE))));
        assertEquals("INVALID_OUTPUT", stopReason(() ->
                PatientDraftCoordinator.validateDraft(new Draft(1, claims), FROZEN)));
    }

    @Test
    void rejectsAnUnknownSection() {
        var claims = claims();
        claims.set(1, new Claim("c2", "PROGNOSIS", "text", List.of(new Reference(0, QUOTE))));
        assertEquals("INVALID_OUTPUT", stopReason(() ->
                PatientDraftCoordinator.validateDraft(new Draft(1, claims), FROZEN)));
    }

    @Test
    void rejectsAQuoteNotCopiedFromTheExcerpt() {
        var claims = claims();
        claims.set(0, new Claim("c1", "MAIN_FINDING", "text", List.of(new Reference(0, "编造引用"))));
        assertEquals("INVALID_CITATION", stopReason(() ->
                PatientDraftCoordinator.validateDraft(new Draft(1, claims), FROZEN)));
    }

    @Test
    void rejectsAnOutOfRangeCitationIndex() {
        var claims = claims();
        claims.set(0, new Claim("c1", "MAIN_FINDING", "text", List.of(new Reference(1, QUOTE))));
        assertEquals("INVALID_CITATION", stopReason(() ->
                PatientDraftCoordinator.validateDraft(new Draft(1, claims), FROZEN)));
    }

    @Test
    void classifiesTransportFaultsApartFromModelOutput() {
        assertEquals("PROVIDER_AUTH", PatientDraftCoordinator.transportFailure(
                new org.springframework.ai.retry.NonTransientAiException("HTTP 401 - unauthorized")));
        assertEquals("PROVIDER_RATE_LIMIT", PatientDraftCoordinator.transportFailure(
                new org.springframework.ai.retry.TransientAiException("HTTP 429 - slow down")));
        assertEquals("PROVIDER_UNAVAILABLE", PatientDraftCoordinator.transportFailure(
                new org.springframework.ai.retry.NonTransientAiException("HTTP 500 - boom")));
        assertEquals("PROVIDER_UNAVAILABLE", PatientDraftCoordinator.transportFailure(
                new java.io.IOException("connection reset")));

        Throwable malformed;
        try {
            new com.fasterxml.jackson.databind.ObjectMapper().readValue("{bad", Object.class);
            throw new AssertionError("expected malformed JSON");
        } catch (com.fasterxml.jackson.core.JsonProcessingException expected) {
            malformed = expected;
        }
        assertEquals("INVALID_OUTPUT", PatientDraftCoordinator.transportFailure(malformed));
    }

    @Test
    void requireTextRejectsBlankAndOversizedValues() {
        PatientDraftCoordinator.requireText("ok", 10);
        assertEquals("INVALID_OUTPUT", stopReason(() -> PatientDraftCoordinator.requireText("   ", 10)));
        assertEquals("INVALID_OUTPUT", stopReason(() ->
                PatientDraftCoordinator.requireText("x".repeat(11), 10)));
    }

    private static String stopReason(Executable action) {
        var error = assertThrows(RuntimeException.class, action);
        assertEquals("Stop", error.getClass().getSimpleName());
        try {
            var field = error.getClass().getDeclaredField("reason");
            field.setAccessible(true);
            return (String) field.get(error);
        } catch (ReflectiveOperationException e) {
            throw new AssertionError(e);
        }
    }
}
