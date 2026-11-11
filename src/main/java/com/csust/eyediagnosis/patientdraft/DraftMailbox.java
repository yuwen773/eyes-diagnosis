package com.csust.eyediagnosis.patientdraft;

import java.util.*;

/** Task-local addressed messages. Only validated role results may be delivered by the runtime. */
final class DraftMailbox {
    static final String VERSION = "AUTONOMOUS_V2";
    record Envelope(String messageId, String taskId, String workflowVersion, String senderRole,
                    String recipientRole, String kind, int sourceSequence, String causationMessageId,
                    String inferenceDigest, Integer evidenceVersion, Integer draftVersion, Object payload, java.time.Instant sentAt) {}
    private final String taskId;
    private final String digest;
    private final java.time.Clock clock;
    private final Map<String, List<Envelope>> inboxes = new HashMap<>();
    private final Map<String, Envelope> delivered = new HashMap<>();
    private final Set<String> consumed = new HashSet<>();

    DraftMailbox(String taskId, String digest, java.time.Clock clock) { this.taskId = taskId; this.digest = digest; this.clock = clock; }

    Envelope send(int sequence, String sender, String recipient, String kind, String cause,
                  Integer evidenceVersion, Integer draftVersion, Object payload) {
        boolean allowed = switch (sender + ":" + kind) {
            case "VISION:VISION_READY" -> Set.of("EVIDENCE", "EXPLANATION", "CRITIC").contains(recipient);
            case "EVIDENCE:EVIDENCE_READY" -> Set.of("EXPLANATION", "CRITIC").contains(recipient);
            case "EXPLANATION:DRAFT_READY" -> recipient.equals("CRITIC");
            case "CRITIC:REWRITE_REQUESTED" -> recipient.equals("EXPLANATION");
            case "CRITIC:SUPPLEMENT_REQUESTED" -> recipient.equals("EVIDENCE");
            case "CRITIC:REVIEW_COMPLETED" -> recipient.equals("GATE");
            default -> false;
        };
        if (!allowed) throw new Rejected("INVALID_MESSAGE_ROUTE");
        String id = taskId + ":" + sequence + ":" + recipient;
        Envelope existing = delivered.get(id);
        if (existing != null) {
            if (!Objects.equals(existing.payload(), payload) || !existing.kind().equals(kind)
                    || !Objects.equals(existing.evidenceVersion(), evidenceVersion) || !Objects.equals(existing.draftVersion(), draftVersion))
                throw new Rejected("MESSAGE_CONFLICT");
            return existing;
        }
        var envelope = new Envelope(id, taskId, VERSION, sender, recipient, kind, sequence, cause,
                digest, evidenceVersion, draftVersion, payload, clock.instant());
        delivered.put(id, envelope);
        inboxes.computeIfAbsent(recipient, ignored -> new ArrayList<>()).add(envelope);
        return envelope;
    }

    Envelope latest(String role, String kind) {
        return inboxes.getOrDefault(role, List.of()).stream().filter(e -> e.kind().equals(kind))
                .reduce((previous, next) -> next).orElse(null);
    }

    boolean unread(Envelope message) { return message != null && !consumed.contains(message.messageId()); }

    List<Envelope> consume(Envelope... messages) {
        var result = new ArrayList<Envelope>();
        for (Envelope message : messages) {
            if (message != null) { consumed.add(message.messageId()); result.add(message); }
        }
        return List.copyOf(result);
    }

    static final class Rejected extends RuntimeException {
        final String reason;
        Rejected(String reason) { super(reason); this.reason = reason; }
    }
}
