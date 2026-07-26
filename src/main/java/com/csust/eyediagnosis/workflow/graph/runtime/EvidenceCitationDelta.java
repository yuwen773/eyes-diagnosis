package com.csust.eyediagnosis.workflow.graph.runtime;

import com.csust.eyediagnosis.workflow.evidence.DiagnosisCitationSnapshot;
import com.csust.eyediagnosis.workflow.evidence.EvidenceSufficiency;
import java.util.List;

public record EvidenceCitationDelta(long retrievalEpoch, List<DiagnosisCitationSnapshot> citations,
                                    EvidenceSufficiency sufficiency) implements SegmentBusinessDelta {
    public EvidenceCitationDelta { citations = citations == null ? List.of() : List.copyOf(citations); if (retrievalEpoch < 0 || sufficiency == null) throw new IllegalArgumentException("invalid evidence citation delta"); }
}
