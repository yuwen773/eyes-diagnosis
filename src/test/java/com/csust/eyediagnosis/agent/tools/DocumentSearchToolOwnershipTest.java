package com.csust.eyediagnosis.agent.tools;

import com.csust.eyediagnosis.agent.rag.DocumentParser;
import com.csust.eyediagnosis.agent.rag.TextChunkerService;
import com.csust.eyediagnosis.mapper.KnowledgeDocumentMapper;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;
import com.csust.eyediagnosis.service.impl.DocumentProcessingService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.ai.vectorstore.filter.Filter;

import java.io.File;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class DocumentSearchToolOwnershipTest {

    @Mock
    private VectorStore vectorStore;
    @InjectMocks
    private DocumentSearchTool tool;

    // 供 processDocument 测试使用；@Mock 只在字段上生效。
    @Mock
    private DocumentParser parser;
    @Mock
    private TextChunkerService chunker;
    @Mock
    private KnowledgeDocumentMapper mapper;

    @Test
    void searchWithoutUserContextReturnsEmptyAndDoesNotQueryStore() {
        String result = tool.searchDocuments("青光眼", null);
        assertEquals("[]", result);
        verifyNoInteractions(vectorStore);
    }

    @Test
    void searchIncludesOwnerAndBuiltinCorpusFilter() {
        when(vectorStore.similaritySearch(any(SearchRequest.class))).thenReturn(List.of());
        tool.searchDocuments("青光眼", 42L);
        ArgumentCaptor<SearchRequest> captor = ArgumentCaptor.forClass(SearchRequest.class);
        verify(vectorStore).similaritySearch(captor.capture());
        Filter.Expression filter = captor.getValue().getFilterExpression();

        // 私有文档按 owner 隔离，内置语料（ownerUserId = 0）对所有用户可见
        assertEquals(Filter.ExpressionType.OR, filter.type());
        Filter.Expression ownerOperand = assertInstanceOf(Filter.Expression.class, filter.left());
        Filter.Expression corpusOperand = assertInstanceOf(Filter.Expression.class, filter.right());
        assertOwnerEquals(ownerOperand, 42L);
        assertOwnerEquals(corpusOperand, 0L);
    }

    private void assertOwnerEquals(Filter.Expression expression, long expectedOwnerId) {
        assertEquals(Filter.ExpressionType.EQ, expression.type());
        assertEquals("ownerUserId", assertInstanceOf(Filter.Key.class, expression.left()).key());
        Number ownerId = assertInstanceOf(Number.class,
                assertInstanceOf(Filter.Value.class, expression.right()).value());
        assertEquals(expectedOwnerId, ownerId.longValue());
    }

    /**
     * 检索隔离的前提是入库时每个 chunk 都带可信的 ownerUserId。
     * 这条测试走真实的 {@code DocumentProcessingService.processDocument}，
     * 而不是自己拼一个 metadata Map 再读回来——那样只能证明 HashMap 能用。
     */
    @Test
    void processDocumentWritesOwnerAndDocumentIdIntoEveryChunk(@TempDir Path tempDir) {
        Long docId = 99L;
        Long ownerId = 7L;

        KnowledgeDocument doc = new KnowledgeDocument();
        doc.setId(docId);
        doc.setUserId(ownerId);

        // 这一组 mock 只服务于 processDocument 的真实实现路径。
        when(parser.parse(anyString(), anyString())).thenReturn(List.of("第一段", "第二段"));
        when(parser.buildMetadata(anyString(), anyString(), anyString(), anyString()))
                .thenReturn(new HashMap<>(Map.of("source", "x")));
        when(mapper.selectById(docId)).thenReturn(doc);
        // 故意返回不可变列表：processDocument 曾对 chunk() 的返回值原地 set()，
        // 换成不可变列表就抛 UnsupportedOperationException 并被吞成 error=null。
        when(chunker.chunk(anyString(), anyMap())).thenReturn(List.of(
                new Document("ignored-0", "chunk text 0", new HashMap<>()),
                new Document("ignored-1", "chunk text 1", new HashMap<>())));

        DocumentProcessingService service = new DocumentProcessingService();
        // 字段是 @Resource / @Autowired 注入的，单测里直接填。
        setField(service, "documentParser", parser);
        setField(service, "textChunkerService", chunker);
        setField(service, "knowledgeDocumentMapper", mapper);
        setField(service, "vectorStore", vectorStore);

        File file = tempDir.resolve("doc.txt").toFile();
        service.processDocument(docId, file, "txt", "标题");

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Document>> captor = ArgumentCaptor.forClass(List.class);
        verify(vectorStore).add(captor.capture());

        List<Document> stored = captor.getValue();
        assertEquals(2, stored.size(), "每个 chunk 都应入库");
        for (Document chunk : stored) {
            assertEquals(ownerId, chunk.getMetadata().get("ownerUserId"),
                    "ownerUserId 必须写进 chunk，否则检索隔离失效");
            assertEquals(docId, chunk.getMetadata().get("documentId"));
        }
        // chunk id 由 docId + 序号生成，保证同一文档的 chunk 可追溯。
        assertEquals("doc_99_chunk_0", stored.get(0).getId());
        assertEquals("doc_99_chunk_1", stored.get(1).getId());
    }

    private static void setField(Object target, String name, Object value) {
        try {
            var field = target.getClass().getDeclaredField(name);
            field.setAccessible(true);
            field.set(target, value);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("无法注入字段 " + name, e);
        }
    }
}
