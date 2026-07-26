package com.csust.eyediagnosis.workflow.graph.runtime;

import com.alibaba.cloud.ai.graph.StateGraph;
import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.graph.definition.DiagnosisGraphDefinition;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;

@Component
public class ManifestGraphSegmentBoundaryResolver implements GraphSegmentBoundaryResolver {
    @Override
    public Optional<SegmentCode> resolveNextSegment(DiagnosisGraphDefinition definition, String publicNextNode) {
        if (StateGraph.END.equals(publicNextNode)) {
            return Optional.empty();
        }
        if (publicNextNode == null || publicNextNode.isBlank()) {
            throw new GraphBoundaryContractException("Graph state snapshot has no public next node");
        }
        List<SegmentCode> matches = definition.manifest().segments().stream()
                .filter(segment -> publicNextNode.equals(segment.entryBoundary()))
                .map(segment -> segment.segmentCode())
                .toList();
        if (matches.isEmpty()) {
            throw new GraphBoundaryContractException("No segment entry boundary matches public next node: " + publicNextNode);
        }
        if (matches.size() > 1) {
            throw new GraphDefinitionInvariantException("Multiple segment entries match public next node: " + publicNextNode);
        }
        return Optional.of(matches.getFirst());
    }
}
