package com.csust.eyediagnosis.agent.rag;

import org.springframework.ai.document.Document;

import java.util.List;
import java.util.Locale;

/**
 * Ordinary-chat RAG source classification. This is a VISIBILITY RESTRICTION only:
 * it runs after the existing {@code ownerUserId == current || ownerUserId == 0}
 * filter and may only remove candidates, never add any.
 *
 * <p>Three facts are deliberately separate from the medical collaboration path:
 * <ul>
 *   <li>{@code ControlledEvidenceRetriever} (approval/version/disease/topic/digest
 *       revalidation) is NOT consulted here and MUST NOT be relaxed by this class.</li>
 *   <li>{@code t_patient_authorization} is a patient-result authorization receipt,
 *       NOT a credential for external documents. AUTHORIZED_EXTERNAL is never
 *       granted by this policy without a separate, reviewed admission path.</li>
 *   <li>Ordinary-chat RAG results are never eligibility proof for medical drafts.</li>
 * </ul>
 *
 * <p>Default off ({@code eye-diagnosis.rag.source-type.enabled=false}). When on,
 * chunks written before this feature has no {@code sourceType} metadata key; we
 * conservatively infer one from trusted server-written metadata. Anything that
 * cannot be inferred is UNKNOWN and is excluded (fail-closed), never silently
 * treated as BUILTIN.
 */
public final class SourceTypePolicy {

    private SourceTypePolicy() {}

    /** Stored in Chroma metadata as {@code "sourceType"}. Never call it {@code source}: that key already means fileUrl. */
    public static final String METADATA_KEY = "sourceType";

    public enum SourceType {
        BUILTIN,
        USER_UPLOAD,
        AUTHORIZED_EXTERNAL,
        UNKNOWN;

        public String wire() { return name().toLowerCase(Locale.ROOT); }
    }

    /**
     * Conservative backfill for legacy chunks. Only three trusted signals are used:
     * the builtin corpus tag / system owner sentinel, and a server-written document
     * id matching the authenticated owner. Anything else is UNKNOWN.
     *
     * <p>Never reads model text, tool arguments, or patient authorization tables.
     */
    public static SourceType classify(Document doc, Long currentUserId) {
        if (doc == null || currentUserId == null) return SourceType.UNKNOWN;
        Object explicit = doc.getMetadata().get(METADATA_KEY);
        if (explicit != null) {
            SourceType parsed = parse(explicit);
            // An explicit marker can never EXPAND visibility: AUTHORIZED_EXTERNAL is
            // not admitted by this policy regardless of what the vector store says,
            // and a marker is only believed when trusted metadata corroborates it.
            if (parsed == SourceType.AUTHORIZED_EXTERNAL || parsed == SourceType.UNKNOWN) {
                return SourceType.UNKNOWN;
            }
            return corroborated(parsed, doc, currentUserId);
        }
        Object corpus = doc.getMetadata().get("corpus");
        Object owner = doc.getMetadata().get("ownerUserId");
        boolean builtin = BuiltinCorpus.CORPUS_TAG.equals(String.valueOf(corpus))
                || (owner instanceof Number n && n.longValue() == BuiltinCorpus.SYSTEM_OWNER_ID);
        if (builtin) return SourceType.BUILTIN;

        boolean hasDocumentId = doc.getMetadata().get("documentId") != null
                || doc.getMetadata().get("docId") != null;
        boolean ownedByCaller = owner instanceof Number n && n.longValue() == currentUserId;
        if (hasDocumentId && ownedByCaller) return SourceType.USER_UPLOAD;

        return SourceType.UNKNOWN;
    }

    /**
     * An explicit marker is only believed when the trusted owner/corpus metadata
     * agrees. A forged BUILTIN tag on another user's chunk must not pass.
     */
    private static SourceType corroborated(SourceType claimed, Document doc, Long currentUserId) {
        Object owner = doc.getMetadata().get("ownerUserId");
        if (claimed == SourceType.BUILTIN) {
            boolean builtinCorpus = BuiltinCorpus.CORPUS_TAG.equals(
                    String.valueOf(doc.getMetadata().get("corpus")));
            boolean systemOwner = owner instanceof Number n
                    && n.longValue() == BuiltinCorpus.SYSTEM_OWNER_ID;
            return builtinCorpus || systemOwner ? SourceType.BUILTIN : SourceType.UNKNOWN;
        }
        if (claimed == SourceType.USER_UPLOAD) {
            boolean ownerMatches = owner instanceof Number n && n.longValue() == currentUserId;
            boolean hasDocumentId = doc.getMetadata().get("documentId") != null
                    || doc.getMetadata().get("docId") != null;
            return ownerMatches && hasDocumentId ? SourceType.USER_UPLOAD : SourceType.UNKNOWN;
        }
        return SourceType.UNKNOWN;
    }

    private static SourceType parse(Object raw) {
        String value = String.valueOf(raw).trim().toUpperCase(Locale.ROOT);
        for (SourceType type : SourceType.values()) {
            if (type.name().equals(value) || type.wire().equals(String.valueOf(raw).trim())) {
                return type;
            }
        }
        return SourceType.UNKNOWN;
    }

    /**
     * Restrict an already owner-filtered candidate list. AUTHORIZED_EXTERNAL and
     * UNKNOWN are always removed; only BUILTIN and USER_UPLOAD survive. This can
     * only shrink the result set relative to the pre-B2 behavior.
     */
    public static List<Document> restrict(List<Document> candidates, Long currentUserId) {
        if (candidates == null || candidates.isEmpty()) return List.of();
        return candidates.stream()
                .filter(doc -> {
                    SourceType type = classify(doc, currentUserId);
                    return type == SourceType.BUILTIN || type == SourceType.USER_UPLOAD;
                })
                .toList();
    }
}
