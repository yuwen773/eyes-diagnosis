package com.csust.eyediagnosis.model.dto.workflow;

import lombok.Data;

import java.io.Serializable;

/**
 * Frozen API contract for starting a diagnosis workflow.
 *
 * <p>Reconciliation note: the workflow domain model stores {@code questionText}, an
 * {@code ownerUserId} and an {@code inferenceEnvelopeId} but has no {@code imageId} or
 * {@code symptoms} columns. To stay within PR-10's boundary (no persistence-model change)
 * {@code imageId} is used as the creation idempotency key (dedup + image correlation) and
 * {@code symptoms} plus {@code imageId} are captured in the WORKFLOW_CREATED audit event
 * payload. The initiated {@code INTAKE_INFERENCE_QUALITY} segment job is what actually
 * drives image inference in the Graph Segment Runtime (unchanged by this PR).
 */
@Data
public class CreateWorkflowRequest implements Serializable {
    private String imageId;
    private String question;
    private SymptomsDTO symptoms;
}
