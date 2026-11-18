package com.csust.eyediagnosis.agent.tools;

import com.csust.eyediagnosis.agent.observability.ToolResourceContext;
import com.csust.eyediagnosis.agent.rag.DocumentParser;
import com.csust.eyediagnosis.agent.rag.TextChunkerService;
import com.csust.eyediagnosis.mapper.KnowledgeDocumentMapper;
import com.csust.eyediagnosis.model.dto.agent.ResourceRef;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;
import com.csust.eyediagnosis.service.impl.DocumentProcessingService;
import org.junit.jupiter.api.BeforeEach;
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
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
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

    /**
     * {@code @Value} 字段在单测里没有容器注入，显式给出生产默认值。
     * 少了 {@code finalTopK} 就是 0——任何命中都不会交给模型，也不会登记成来源，
     * 测试会静默变成「空检索」。
     */
    @BeforeEach
    void applySearchDefaults() {
        setField(tool, "searchTopK", 20);
        setField(tool, "finalTopK", 5);
        setField(tool, "similarityThreshold", 0.5);
        setField(tool, "rerankEnabled", false);
    }

    /** 没有可信用户上下文时必须失败，而不是返回「没找到」这种假成功。 */
    @Test
    void searchWithoutUserContextFailsAndDoesNotQueryStore() {
        IllegalStateException thrown = assertThrows(IllegalStateException.class,
                () -> tool.searchDocuments("青光眼", null));
        assertTrue(thrown.getMessage().contains("登录"));
        verifyNoInteractions(vectorStore);
    }

    /** 向量库未配置同样是一次「没做成」，不能长成 success。 */
    @Test
    void missingVectorStoreIsSurfacedAsFailure() {
        DocumentSearchTool withoutStore = new DocumentSearchTool();
        IllegalStateException thrown = assertThrows(IllegalStateException.class,
                () -> withoutStore.searchDocuments("青光眼", 42L));
        assertTrue(thrown.getMessage().contains("暂未启用"));
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
     * 回归：雪花 ID 超过 int 范围。旧实现把过滤条件拼成文本，文本解析器按
     * {@code Integer} 解析数字字面量，真实用户（19 位 ID）一检索就
     * {@code NumberFormatException}，随后被 catch 吞成「暂时不可用」。
     */
    @Test
    void snowflakeOwnerIdDoesNotOverflowTheFilter() {
        long snowflake = 2123010432165113858L;
        when(vectorStore.similaritySearch(any(SearchRequest.class))).thenReturn(List.of());

        tool.searchDocuments("青光眼", snowflake);

        ArgumentCaptor<SearchRequest> captor = ArgumentCaptor.forClass(SearchRequest.class);
        verify(vectorStore).similaritySearch(captor.capture());
        Filter.Expression filter = captor.getValue().getFilterExpression();
        assertEquals(Filter.ExpressionType.OR, filter.type());
        assertOwnerEquals(assertInstanceOf(Filter.Expression.class, filter.left()), snowflake);
    }

    /** 检索失败必须抛出去变成「工具失败」，不能伪装成一句正常返回值。 */
    @Test
    void retrievalFailureIsSurfacedInsteadOfDisguised() {
        when(vectorStore.similaritySearch(any(SearchRequest.class)))
                .thenThrow(new RuntimeException("向量库不可达"));

        IllegalStateException thrown = assertThrows(IllegalStateException.class,
                () -> tool.searchDocuments("青光眼", 42L));
        assertEquals("知识库检索暂时不可用，请稍后重试。", thrown.getMessage());
    }

    /**
     * 命中的文档必须登记成结构化来源：文档 ID / 相关度 / 片段都取自检索结果，
     * 前端资源栏据此展示可核验的出处。没有 docId 的片段不登记（不可核验）。
     */
    @Test
    void hitsAreRegisteredAsStructuredCitations() {
        Document withId = Document.builder()
                .id("chunk-1")
                .text("睑板腺功能障碍是干眼的主要原因之一。")
                .metadata(Map.of("docId", 42, "title", "干眼症诊疗共识"))
                .score(0.81)
                .build();
        Document withoutId = Document.builder()
                .id("chunk-2")
                .text("没有文档标识的片段")
                .metadata(Map.of("title", "无来源"))
                .score(0.6)
                .build();
        when(vectorStore.similaritySearch(any(SearchRequest.class)))
                .thenReturn(new ArrayList<>(List.of(withId, withoutId)));

        try {
            tool.searchDocuments("干眼", 42L);

            List<ResourceRef> refs = ToolResourceContext.drain();
            assertEquals(1, refs.size(), "只有带 docId 的命中才算可核验来源");
            ResourceRef ref = refs.get(0);
            assertEquals("document", ref.kind());
            assertEquals("42", ref.documentId());
            assertEquals("干眼症诊疗共识", ref.title());
            assertEquals(0.81, ref.score());
            assertNull(ref.retrievalScore(), "没有 rerank 时不存在第二个分数，保持为空");
            assertEquals("knowledge-base", ref.source());
            assertEquals("睑板腺功能障碍是干眼的主要原因之一。", ref.snippet());
        } finally {
            ToolResourceContext.drain();
        }
    }

    @Test
    void failedRetrievalRegistersNoCitations() {
        when(vectorStore.similaritySearch(any(SearchRequest.class)))
                .thenThrow(new RuntimeException("向量库不可达"));

        assertThrows(IllegalStateException.class, () -> tool.searchDocuments("干眼", 42L));
        assertEquals(List.of(), ToolResourceContext.drain(),
                "失败的一次检索不能在资源栏留下任何来源");
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
