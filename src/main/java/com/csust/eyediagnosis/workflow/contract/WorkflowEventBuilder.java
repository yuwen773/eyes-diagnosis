package com.csust.eyediagnosis.workflow.contract;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.Map;
import java.util.UUID;

/**
 * Single source of truth for constructing {@link RecordEventCommand} workflow events.
 *
 * <p>Previously the event serialisation diverged in three places: the api command surface built a
 * JSON payload via {@code ObjectMapper}, the review service concatenated a JSON string by hand, and
 * the (frozen) graph/runtime path used its own {@code WorkflowEventDraft}. This builder unifies the
 * first two into one typed entry point so both produce an identical, well-formed event. The
 * graph/runtime path is intentionally NOT touched (it is freeze-protected).</p>
 */
public final class WorkflowEventBuilder {

    public static final String EVENT_TYPE_CREATED = "WORKFLOW_CREATED";
    public static final String EVENT_TYPE_DECISION = "HUMAN_REVIEW_DECISION_SUBMITTED";
    public static final String ACTOR_TYPE_USER = "USER";
    public static final String ACTOR_TYPE_DOCTOR = "DOCTOR";

    private WorkflowEventBuilder() {
    }

    public static RecordEventCommand createdEvent(String workflowId, String actorId, String segmentCode,
                                                  Map<String, Object> payload, ObjectMapper objectMapper) {
        String snapshot;
        try {
            snapshot = objectMapper.writeValueAsString(payload);
        } catch (Exception ex) {
            snapshot = "{}";
        }
        return new RecordEventCommand(workflowId, EVENT_TYPE_CREATED, ACTOR_TYPE_USER, actorId,
                0L, 1L, segmentCode, null, snapshot);
    }

    public static RecordEventCommand decisionEvent(String workflowId, String reviewTaskId, String decisionCode,
                                                   String actorId, long expectedWorkflowVersion,
                                                   String segmentCode, String reasonCode) {
        String snapshot = "{\"reviewTaskId\":\"" + reviewTaskId + "\",\"decisionCode\":\""
                + decisionCode + "\"}";
        long advanced = expectedWorkflowVersion + 1;
        return new RecordEventCommand(workflowId, EVENT_TYPE_DECISION, ACTOR_TYPE_DOCTOR, actorId,
                advanced, advanced, segmentCode, reasonCode, snapshot);
    }
}
