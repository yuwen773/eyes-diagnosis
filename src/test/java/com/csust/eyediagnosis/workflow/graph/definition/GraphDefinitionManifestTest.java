package com.csust.eyediagnosis.workflow.graph.definition;

import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class GraphDefinitionManifestTest {
    @Test
    void rejectsUnknownEdgeTargetsAndUnreachableNodes() {
        assertThrows(IllegalArgumentException.class, () -> new GraphDefinitionManifest("g", "v", "a",
                List.of(new GraphNodeSpec("START", "BOUNDARY"), new GraphNodeSpec("END", "BOUNDARY")),
                List.of(new GraphEdgeSpec("START", "missing")), List.of(), List.of(), List.of(), List.of()));
        assertThrows(IllegalArgumentException.class, () -> new GraphDefinitionManifest("g", "v", "a",
                List.of(new GraphNodeSpec("START", "BOUNDARY"), new GraphNodeSpec("orphan", "ACTION"), new GraphNodeSpec("END", "BOUNDARY")),
                List.of(new GraphEdgeSpec("START", "END")), List.of(), List.of(), List.of(), List.of()));
    }

    @Test
    void standardV1ContainsTheFrozenFiveSegmentBoundaries() {
        var definition = new StandardFundusDiagnosisGraphV1(new Sha256GraphDefinitionHasher());
        assertEquals(5, definition.manifest().segments().size());
        assertEquals(List.of(SegmentCode.INTAKE_INFERENCE_QUALITY, SegmentCode.QUALITY_REVIEW_RESUME,
                SegmentCode.EVIDENCE_RETRIEVAL_VALIDATION, SegmentCode.FINAL_RISK_EXPLANATION,
                SegmentCode.FINAL_CLINICAL_REVIEW_RESUME), definition.manifest().segments().stream().map(GraphSegmentSpec::segmentCode).toList());
        assertEquals(18, definition.manifest().nodes().size());
    }
}
