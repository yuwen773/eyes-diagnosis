package com.csust.eyediagnosis.agent.tools;

import com.csust.eyediagnosis.mapper.KnowledgeDocumentMapper;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;
import org.junit.jupiter.api.Test;
import org.springframework.ai.document.Document;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * P1-02 读取侧：向量搜索会返回「文档其实没入库成功」的残留片段。
 * 证据准入必须把它们挡掉，同时不能误伤正常文档。
 */
class DocumentSearchToolReadyOnlyTest {

    private static Document chunk(String id, Object documentId) {
        Map<String, Object> metadata = new HashMap<>();
        if (documentId != null) metadata.put("documentId", documentId);
        return new Document(id, "片段 " + id, metadata);
    }

    private static KnowledgeDocument doc(long id, int status) {
        KnowledgeDocument row = new KnowledgeDocument();
        row.setId(id);
        row.setStatus(status);
        return row;
    }

    @Test
    void failedDocumentChunksAreNotEvidence() {
        KnowledgeDocumentMapper mapper = mock(KnowledgeDocumentMapper.class);
        when(mapper.selectBatchIds(any())).thenReturn(List.of(doc(1L, 1), doc(2L, 2)));

        DocumentSearchTool tool = new DocumentSearchTool();
        ReflectionTestUtils.setField(tool, "knowledgeDocumentMapper", mapper);

        List<Document> kept = tool.readyOnly(List.of(chunk("a", 1L), chunk("b", 2L)));
        assertEquals(List.of("a"), kept.stream().map(Document::getId).toList());
    }

    @Test
    void chunksWithoutDocumentIdAreNotJudged() {
        // 旧数据/直写语料没有 documentId：不凭空判死
        KnowledgeDocumentMapper mapper = mock(KnowledgeDocumentMapper.class);
        DocumentSearchTool tool = new DocumentSearchTool();
        ReflectionTestUtils.setField(tool, "knowledgeDocumentMapper", mapper);

        List<Document> kept = tool.readyOnly(List.of(chunk("legacy", null)));
        assertEquals(1, kept.size());
    }

    @Test
    void statusLookupFailureFailsClosed() {
        KnowledgeDocumentMapper mapper = mock(KnowledgeDocumentMapper.class);
        when(mapper.selectBatchIds(any())).thenThrow(new IllegalStateException("db down"));

        DocumentSearchTool tool = new DocumentSearchTool();
        ReflectionTestUtils.setField(tool, "knowledgeDocumentMapper", mapper);

        List<Document> kept = tool.readyOnly(List.of(chunk("a", 1L), chunk("legacy", null)));
        assertEquals(List.of("legacy"), kept.stream().map(Document::getId).toList(),
                "状态查不到时宁可少引用，也不把状态不明的片段当证据");
    }

    @Test
    void stringDocumentIdsAreRecognized() {
        // 元数据可能以字符串形式落库（docId 有 toString 版本）；两种都要认
        KnowledgeDocumentMapper mapper = mock(KnowledgeDocumentMapper.class);
        when(mapper.selectBatchIds(any())).thenReturn(List.of(doc(3L, 1)));

        DocumentSearchTool tool = new DocumentSearchTool();
        ReflectionTestUtils.setField(tool, "knowledgeDocumentMapper", mapper);

        List<Document> kept = tool.readyOnly(List.of(chunk("a", "3")));
        assertEquals(1, kept.size());
    }
}
