package com.csust.eyediagnosis.workflow.graph.runtime;

import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.graph.definition.DiagnosisGraphDefinition;

import java.util.Optional;

public interface GraphSegmentBoundaryResolver {
    Optional<SegmentCode> resolveNextSegment(DiagnosisGraphDefinition definition, String publicNextNode);
}
