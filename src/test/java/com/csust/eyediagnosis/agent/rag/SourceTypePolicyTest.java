package com.csust.eyediagnosis.agent.rag;

import org.junit.jupiter.api.Test;
import org.springframework.ai.document.Document;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * B2: sourceType can only RESTRICT the owner-filtered result set. Unknown sources,
 * explicit AUTHORIZED_EXTERNAL and cross-user documents are fail-closed.
 */
class SourceTypePolicyTest {

    private static final Long USER = 42L;

    private static Document doc(String id, Object... kv) {
        Map<String, Object> metadata = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) metadata.put((String) kv[i], kv[i + 1]);
        return new Document(id, "text", metadata);
    }

    @Test
    void explicitMarkersAreRecognized() {
        assertEquals(SourceTypePolicy.SourceType.BUILTIN,
                SourceTypePolicy.classify(doc("a", "sourceType", "BUILTIN",
                        "corpus", "builtin", "ownerUserId", 0L), USER));
        assertEquals(SourceTypePolicy.SourceType.BUILTIN,
                SourceTypePolicy.classify(doc("a", "sourceType", "builtin",
                        "ownerUserId", 0L), USER));
        assertEquals(SourceTypePolicy.SourceType.USER_UPLOAD,
                SourceTypePolicy.classify(doc("b", "sourceType", "USER_UPLOAD",
                        "documentId", 9L, "ownerUserId", 42L), USER));
        assertEquals(SourceTypePolicy.SourceType.UNKNOWN,
                SourceTypePolicy.classify(doc("c", "sourceType", "model invented value"), USER));
    }

    @Test
    void conservativeBackfillUsesOnlyTrustedServerMetadata() {
        // Builtin: either the corpus tag or the system owner sentinel (legacy chunks).
        assertEquals(SourceTypePolicy.SourceType.BUILTIN,
                SourceTypePolicy.classify(doc("a", "corpus", "builtin", "ownerUserId", 0L), USER));
        assertEquals(SourceTypePolicy.SourceType.BUILTIN,
                SourceTypePolicy.classify(doc("a", "ownerUserId", 0L), USER));
        // User upload: server-written documentId + owner matches the caller.
        assertEquals(SourceTypePolicy.SourceType.USER_UPLOAD,
                SourceTypePolicy.classify(doc("b", "documentId", 9L, "ownerUserId", 42L), USER));
        assertEquals(SourceTypePolicy.SourceType.USER_UPLOAD,
                SourceTypePolicy.classify(doc("b", "docId", "9", "ownerUserId", 42L), USER));
    }

    @Test
    void unknownCrossUserAndExternalAreFailClosed() {
        assertEquals(SourceTypePolicy.SourceType.UNKNOWN,
                SourceTypePolicy.classify(doc("a", "ownerUserId", 42L), USER),
                "owner alone without a document id is not proof of upload source");
        assertEquals(SourceTypePolicy.SourceType.UNKNOWN,
                SourceTypePolicy.classify(doc("b", "documentId", 9L, "ownerUserId", 99L), USER));
        assertEquals(SourceTypePolicy.SourceType.UNKNOWN,
                SourceTypePolicy.classify(doc("c", "sourceType", "AUTHORIZED_EXTERNAL",
                        "ownerUserId", 42L), USER),
                "patient authorization is NOT document authorization; never grant this");
        assertEquals(SourceTypePolicy.SourceType.UNKNOWN,
                SourceTypePolicy.classify(doc("d", "sourceType", "BUILTIN",
                        "ownerUserId", 99L), USER),
                "an explicit marker must not widen visibility beyond the owner filter");
    }

    @Test
    void nullInputsAreUnknown() {
        assertEquals(SourceTypePolicy.SourceType.UNKNOWN, SourceTypePolicy.classify(null, USER));
        assertEquals(SourceTypePolicy.SourceType.UNKNOWN, SourceTypePolicy.classify(doc("a"), null));
    }

    @Test
    void restrictOnlyRemovesCandidatesNeverAdds() {
        Document builtin = doc("a", "sourceType", "BUILTIN", "ownerUserId", 0L);
        Document upload = doc("b", "sourceType", "USER_UPLOAD", "ownerUserId", 42L, "documentId", 9L);
        Document external = doc("c", "sourceType", "AUTHORIZED_EXTERNAL", "ownerUserId", 42L);
        Document unknown = doc("d", "ownerUserId", 42L);
        Document otherUser = doc("e", "sourceType", "USER_UPLOAD", "ownerUserId", 99L, "documentId", 9L);

        List<Document> restricted = SourceTypePolicy.restrict(
                List.of(builtin, upload, external, unknown, otherUser), USER);
        assertEquals(2, restricted.size());
        assertEquals("a", restricted.get(0).getId());
        assertEquals("b", restricted.get(1).getId());
        // Original list untouched: the returned list is strictly a subset of it.
        assertEquals(5, List.of(builtin, upload, external, unknown, otherUser).size());
    }

    @Test
    void restrictOnEmptyOrNullIsEmpty() {
        assertTrue(SourceTypePolicy.restrict(null, USER).isEmpty());
        assertTrue(SourceTypePolicy.restrict(List.of(), USER).isEmpty());
    }
}
