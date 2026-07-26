package com.csust.eyediagnosis.workflow.graph.runtime;

import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.alibaba.cloud.ai.graph.StateGraph;
import com.csust.eyediagnosis.workflow.graph.definition.DiagnosisGraphDefinition;
import com.csust.eyediagnosis.workflow.graph.definition.DiagnosisGraphDefinitionFactory;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionManifest;
import com.csust.eyediagnosis.workflow.graph.definition.GraphEdgeSpec;
import com.csust.eyediagnosis.workflow.graph.definition.GraphNodeSpec;
import com.csust.eyediagnosis.workflow.graph.definition.GraphSegmentSpec;
import com.csust.eyediagnosis.workflow.graph.definition.Sha256GraphDefinitionHasher;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ManifestGraphSegmentBoundaryResolverTest {
    private final DiagnosisGraphDefinition definition = DiagnosisGraphDefinitionFactory.create(new GraphDefinitionManifest(
            "synthetic", "v1", "actions-v1",
            List.of(new GraphNodeSpec("START", "BOUNDARY"), new GraphNodeSpec("resume", "ACTION"), new GraphNodeSpec("END", "BOUNDARY")),
            List.of(new GraphEdgeSpec("START", "resume"), new GraphEdgeSpec("resume", "END")), List.of(),
            List.of(new GraphSegmentSpec(SegmentCode.INTAKE_INFERENCE_QUALITY, "START", "resume"),
                    new GraphSegmentSpec(SegmentCode.EVIDENCE_RETRIEVAL_VALIDATION, "resume", "END")),
            List.of(), List.of()), new Sha256GraphDefinitionHasher());

    @Test
    void onlyResolvesAnExactManifestEntryOrEnd() {
        ManifestGraphSegmentBoundaryResolver resolver = new ManifestGraphSegmentBoundaryResolver();
        assertEquals(SegmentCode.EVIDENCE_RETRIEVAL_VALIDATION, resolver.resolveNextSegment(definition, "resume").orElseThrow());
        assertEquals(java.util.Optional.empty(), resolver.resolveNextSegment(definition, StateGraph.END));
        assertThrows(GraphBoundaryContractException.class, () -> resolver.resolveNextSegment(definition, "unknown"));
    }
}
