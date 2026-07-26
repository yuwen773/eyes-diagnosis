package com.csust.eyediagnosis.workflow.evidence;
import org.junit.jupiter.api.Test; import static org.junit.jupiter.api.Assertions.*;
class EvidenceCandidateTest { @Test void digestUsesNormalizedQuoteText() { assertEquals(EvidenceValues.digest("a b"), EvidenceValues.digest(" a\n b ")); assertThrows(IllegalArgumentException.class, () -> new DiagnosisCitationSnapshot("wf", 1, "source", "r", "chunk", "title", "", "x", java.util.Set.of("amd"), java.util.Set.of("DISEASE_OVERVIEW"), .1, "policy", "catalog")); } }
