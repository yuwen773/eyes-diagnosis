package com.csust.eyediagnosis.agent.tools;

import com.csust.eyediagnosis.agent.observability.ToolResourceContext;
import com.csust.eyediagnosis.mapper.KnowledgeDocumentMapper;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;
import org.junit.jupiter.api.Test;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * P1-02 读取侧的**真实执行路径**。
 *
 * <p>已有的 {@code DocumentSearchToolReadyOnlyTest} 直接调私有过滤方法，
 * 证明不了「旧代片段不会真的被检索出来」。这里从 {@code searchDocuments}
 * 走一遍：向量库返回旧代与当代片段 → 准入过滤 → 模型实际看到的文本。
 *
 * <p>复现的失效模式：文档重新处理后，向量库里仍留着上一代的片段
 * （失败清理没跑完、或重试用了更短的输入）。这些片段文本仍然相关、
 * 分数也不低——但它们属于一份**没有完成处理**的文档，不能当证据给模型。
 */
class DocumentSearchToolStaleGenerationTest {

    private static Document chunk(String id, Object documentId, String indexVersion) {
        Map<String, Object> metadata = new HashMap<>();
        if (documentId != null) metadata.put("documentId", documentId);
        metadata.put("indexVersion", indexVersion);
        metadata.put("docId", documentId);
        return Document.builder()
                .id(id)
                .text("片段内容 " + id)
                .metadata(metadata)
                .score(0.9)
                .build();
    }

    private static KnowledgeDocument published(long id, String indexVersion) {
        KnowledgeDocument row = new KnowledgeDocument();
        row.setId(id);
        row.setStatus(1);
        row.setIndexVersion(indexVersion);
        return row;
    }

    private static DocumentSearchTool tool(VectorStore vectorStore, KnowledgeDocumentMapper mapper) {
        DocumentSearchTool tool = new DocumentSearchTool();
        ReflectionTestUtils.setField(tool, "vectorStore", vectorStore);
        ReflectionTestUtils.setField(tool, "knowledgeDocumentMapper", mapper);
        ReflectionTestUtils.setField(tool, "searchTopK", 20);
        ReflectionTestUtils.setField(tool, "finalTopK", 5);
        ReflectionTestUtils.setField(tool, "similarityThreshold", 0.0);
        ReflectionTestUtils.setField(tool, "rerankEnabled", false);
        ReflectionTestUtils.setField(tool, "hybridSearchEnabled", false);
        ReflectionTestUtils.setField(tool, "sourceTypeRestrictionEnabled", false);
        return tool;
    }

    @Test
    void staleGenerationChunksNeverReachTheModelThroughTheSearchPath() {
        KnowledgeDocumentMapper mapper = mock(KnowledgeDocumentMapper.class);
        // 文档已经重新处理过：当前发布版本是 attempt-2。
        when(mapper.selectBatchIds(any())).thenReturn(List.of(published(1L, "attempt-2")));
        VectorStore vectorStore = mock(VectorStore.class);
        when(vectorStore.similaritySearch(any(SearchRequest.class))).thenReturn(List.of(
                chunk("stale-attempt-1", 1L, "attempt-1"),
                chunk("fresh-attempt-2", 1L, "attempt-2")));

        String answer;
        try {
            answer = tool(vectorStore, mapper).searchDocuments("青光眼", 7L);
        } finally {
            // 检索成功会往 ToolResourceContext（线程内）登记来源。
            // 不清掉的话，同一线程上跑的下一个用例会看到本用例的残留来源——
            // 那会让无关用例变成顺序相关的假失败（CI 上已出现过一次）。
            ToolResourceContext.drain();
        }

        assertFalse(answer.contains("stale-attempt-1"), "旧代片段不得作为证据交给模型");
        assertTrue(answer.contains("fresh-attempt-2"), "当前代的片段必须照常返回");
    }

    @Test
    void aFailedDocumentYieldsNoEvidenceAtAll() {
        KnowledgeDocumentMapper mapper = mock(KnowledgeDocumentMapper.class);
        // 这次处理失败了：状态不是 READY。库里可能留着上一代的片段。
        KnowledgeDocument failed = published(1L, "attempt-2");
        failed.setStatus(2);
        when(mapper.selectBatchIds(any())).thenReturn(List.of(failed));
        VectorStore vectorStore = mock(VectorStore.class);
        when(vectorStore.similaritySearch(any(SearchRequest.class))).thenReturn(List.of(
                chunk("stale-attempt-1", 1L, "attempt-1"),
                chunk("fresh-attempt-2", 1L, "attempt-2")));

        String answer;
        try {
            answer = tool(vectorStore, mapper).searchDocuments("青光眼", 7L);
        } finally {
            ToolResourceContext.drain();
        }

        assertFalse(answer.contains("attempt-1"));
        assertFalse(answer.contains("attempt-2"), "处理未完成的文档不能当证据");
    }
}
