package com.csust.eyediagnosis.agent;

import com.csust.eyediagnosis.model.dto.agent.ResourceRef;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * sink 只把**成功调用**、**带片段序号**的来源记成证据键。
 * 失败调用的资源是空的；没有序号的文档级来源无法核验。
 */
class ToolStepSinkEvidenceKeysTest {

    private static ToolStepSink sink() {
        return new ToolStepSink("session", 42L, audit -> { });
    }

    @Test
    void successfulChunkResourcesBecomeVerifiableKeys() {
        ToolStepSink sink = sink();
        sink.started("call-1", "searchDocuments", null, null);
        sink.finished("call-1", "searchDocuments", true, null,
                List.of(ResourceRef.documentChunk("42", "doc_42_v1_chunk_3", 3,
                                "共识", 0.9, null, "片段", "call-1"),
                        ResourceRef.documentChunk("42", "doc_42_v1_chunk_4", 4,
                                "共识", 0.8, null, "片段", "call-1")),
                "输出");

        assertEquals(Set.of("42#3", "42#4"), sink.evidenceKeys(),
                "同一文档的两段各是一个证据键");
    }

    @Test
    void failedCallContributesNoEvidence() {
        ToolStepSink sink = sink();
        sink.started("call-1", "searchDocuments", null, null);
        sink.finished("call-1", "searchDocuments", false, ToolStepContract.ErrorCategory.TOOL_EXCEPTION,
                List.of(ResourceRef.documentChunk("42", "doc_42_v1_chunk_3", 3,
                        "共识", 0.9, null, "片段", "call-1")),
                null);

        assertTrue(sink.evidenceKeys().isEmpty(), "失败调用带出来的片段不能当依据");
    }

    @Test
    void documentLevelRefsWithoutChunkIndexAreNotEvidence() {
        ToolStepSink sink = sink();
        sink.started("call-1", "searchDocuments", null, null);
        sink.finished("call-1", "searchDocuments", true, null,
                List.of(new ResourceRef("doc:42", "document", "共识", "knowledge-base",
                        null, "42", 0.9, null, "片段", "call-1")),
                "输出");

        assertTrue(sink.evidenceKeys().isEmpty());
    }

    @Test
    void cancelledCallsDoNotAddEvidence() {
        ToolStepSink sink = sink();
        sink.started("call-1", "searchDocuments", null, null);
        sink.closePending();

        assertTrue(sink.evidenceKeys().isEmpty());
    }
}
