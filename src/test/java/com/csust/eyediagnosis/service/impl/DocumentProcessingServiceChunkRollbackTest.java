package com.csust.eyediagnosis.service.impl;

import com.csust.eyediagnosis.agent.rag.DocumentParser;
import com.csust.eyediagnosis.agent.rag.TextChunkerService;
import com.csust.eyediagnosis.mapper.KnowledgeDocumentMapper;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.ai.vectorstore.filter.Filter;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * P1-02：分批写向量不是原子的。
 *
 * <p>Codex 的复现：注入 11 个片段，第 2 批写入失败——MySQL 状态标成失败
 * （chunkCount 为空），向量库里却留着第 1 批的 10 个片段，检索照样把它们
 * 当来源交给模型。这里钉住「失败即回滚 + 标记失败」。
 */
class DocumentProcessingServiceChunkRollbackTest {

    @Test
    void secondBatchFailurePurgesResidualChunksAndMarksFailed() throws Exception {
        VectorStore vectorStore = mock(VectorStore.class);
        // 第一批 10 条成功，第二批（第 11 条）失败
        doNothing().doThrow(new IllegalStateException("embedding batch 2 failed"))
                .when(vectorStore).add(anyList());

        KnowledgeDocumentMapper mapper = mock(KnowledgeDocumentMapper.class);
        KnowledgeDocument row = new KnowledgeDocument();
        row.setId(124L);
        row.setUserId(42L);
        row.setIndexVersion("attempt");
        when(mapper.selectById(124L)).thenReturn(row);

        DocumentParser parser = mock(DocumentParser.class);
        File temp = Files.createTempFile("etl-rollback", ".txt").toFile();
        Files.writeString(temp.toPath(), "白内障 青光眼");
        when(parser.parse(any(), any())).thenReturn(List.of("白内障 青光眼"));
        when(parser.buildMetadata(any(), any(), any(), any())).thenReturn(new HashMap<>(Map.of("title", "t")));

        TextChunkerService chunker = mock(TextChunkerService.class);
        List<Document> chunks = new ArrayList<>();
        for (int i = 0; i < 11; i++) {
            chunks.add(new Document("seed-" + i, "片段 " + i, new HashMap<>(Map.of("documentId", 124L))));
        }
        when(chunker.chunk(any(), any())).thenReturn(chunks);

        DocumentProcessingService service = new DocumentProcessingService();
        ReflectionTestUtils.setField(service, "vectorStore", vectorStore);
        ReflectionTestUtils.setField(service, "knowledgeDocumentMapper", mapper);
        ReflectionTestUtils.setField(service, "documentParser", parser);
        ReflectionTestUtils.setField(service, "textChunkerService", chunker);

        service.processDocument(124L, temp, ".txt", "t", "attempt");

        // 残留按 documentId 元数据清理（不依赖 chunkCount —— 失败文档没有它）
        ArgumentCaptor<Filter.Expression> filter = ArgumentCaptor.forClass(Filter.Expression.class);
        verify(vectorStore, atLeastOnce()).delete(filter.capture());
        Filter.Expression expression = filter.getValue();
        assertEquals(Filter.ExpressionType.AND, expression.type());
        assertEquals("documentId", ((Filter.Key) ((Filter.Expression) expression.left()).left()).key());
        assertEquals("indexVersion", ((Filter.Key) ((Filter.Expression) expression.right()).left()).key());

        // 状态落成 2（失败），且没有写 chunkCount
        verify(mapper).finishIndex(124L, "attempt", 2, null);

        temp.delete();
    }

    @Test
    void fullSuccessWritesReadyStatusAndDoesNotPurge() throws Exception {
        VectorStore vectorStore = mock(VectorStore.class);
        KnowledgeDocumentMapper mapper = mock(KnowledgeDocumentMapper.class);
        KnowledgeDocument row = new KnowledgeDocument();
        row.setId(125L);
        row.setUserId(42L);
        row.setIndexVersion("attempt");
        when(mapper.selectById(125L)).thenReturn(row);

        DocumentParser parser = mock(DocumentParser.class);
        File temp = Files.createTempFile("etl-ok", ".txt").toFile();
        Files.writeString(temp.toPath(), "内容");
        when(parser.parse(any(), any())).thenReturn(List.of("内容"));
        when(parser.buildMetadata(any(), any(), any(), any())).thenReturn(new HashMap<>(Map.of("title", "t")));

        TextChunkerService chunker = mock(TextChunkerService.class);
        when(chunker.chunk(any(), any())).thenReturn(List.of(
                new Document("a", "片段", new HashMap<>(Map.of("documentId", 125L)))));

        DocumentProcessingService service = new DocumentProcessingService();
        ReflectionTestUtils.setField(service, "vectorStore", vectorStore);
        ReflectionTestUtils.setField(service, "knowledgeDocumentMapper", mapper);
        ReflectionTestUtils.setField(service, "documentParser", parser);
        ReflectionTestUtils.setField(service, "textChunkerService", chunker);

        service.processDocument(125L, temp, ".txt", "t", "attempt");

        verify(mapper).finishIndex(125L, "attempt", 1, 1);
        verify(vectorStore, times(0)).delete(any(Filter.Expression.class));

        temp.delete();
    }
}
