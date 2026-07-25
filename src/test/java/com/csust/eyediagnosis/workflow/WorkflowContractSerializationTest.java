package com.csust.eyediagnosis.workflow;

import com.csust.eyediagnosis.workflow.contract.EvidenceRetrievalInput;
import com.csust.eyediagnosis.workflow.contract.ImageQualitySnapshot;
import com.csust.eyediagnosis.workflow.contract.InferenceEnvelope;
import com.csust.eyediagnosis.workflow.contract.PredictionSnapshot;
import com.csust.eyediagnosis.workflow.domain.InferenceOutcomeType;
import com.csust.eyediagnosis.workflow.domain.SafetyAbstentionReasonCode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;

class WorkflowContractSerializationTest {
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void serializesAndDeserializesRepresentativeRecordsAndEnums() throws Exception {
        EvidenceRetrievalInput retrievalInput = new EvidenceRetrievalInput("workflow-1", "DR",
                Set.of("general-information"), "what is DR", 1);
        String retrievalJson = objectMapper.writeValueAsString(retrievalInput);
        assertEquals(retrievalInput, objectMapper.readValue(retrievalJson, EvidenceRetrievalInput.class));

        InferenceEnvelope envelope = new InferenceEnvelope("workflow-1", 1, "cos://image", "digest",
                new ImageQualitySnapshot(100, false, Set.of()), InferenceOutcomeType.SAFETY_ABSTENTION,
                new PredictionSnapshot("DR", 0.7, 0.1), SafetyAbstentionReasonCode.OOD, null,
                true, "model-v1", "sha256", "calibrated");
        String envelopeJson = objectMapper.writeValueAsString(envelope);
        assertEquals(envelope, objectMapper.readValue(envelopeJson, InferenceEnvelope.class));
    }
}
