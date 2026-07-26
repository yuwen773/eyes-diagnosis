package com.csust.eyediagnosis.workflow.graph.definition;

import com.csust.eyediagnosis.workflow.domain.SegmentCode;

public record GraphSegmentSpec(SegmentCode segmentCode, String entryBoundary, String exitBoundary) {
}
