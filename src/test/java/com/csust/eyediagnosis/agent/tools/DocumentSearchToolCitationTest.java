package com.csust.eyediagnosis.agent.tools;

import com.alibaba.cloud.ai.document.DocumentWithScore;
import com.alibaba.cloud.ai.model.RerankModel;
import com.alibaba.cloud.ai.model.RerankRequest;
import com.alibaba.cloud.ai.model.RerankResponse;
import com.csust.eyediagnosis.agent.observability.ToolResourceContext;
import com.csust.eyediagnosis.model.dto.agent.ResourceRef;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * 结构化来源必须与「实际交给模型的片段」一致。
 *
 * <p>回归背景：旧实现先 {@code recordCitations(candidates)}、再 rerank 与
 * {@code finalTopK} 截断，侧栏里会出现模型从没见过的候选文档，分数也停在
 * 检索分上。这里的断言都按「同一份结果、同一顺序、同一分数」写。
 */
@ExtendWith(MockitoExtension.class)
class DocumentSearchToolCitationTest {

    @Mock
    private VectorStore vectorStore;
    @Mock
    private RerankModel rerankModel;
    @InjectMocks
    private DocumentSearchTool tool;

    @BeforeEach
    void applyConfig() {
        setField(tool, "searchTopK", 20);
        setField(tool, "finalTopK", 3);
        setField(tool, "similarityThreshold", 0.5);
        setField(tool, "rerankEnabled", false);
        ToolResourceContext.drain();
    }

    @AfterEach
    void clearContext() {
        ToolResourceContext.drain();
    }

    /** 命中数大于 finalTopK 时，只登记真正交给模型的那几条，且顺序一致。 */
    @Test
    void citationsAreExactlyTheFragmentsHandedToTheModel() {
        setField(tool, "finalTopK", 2);
        List<Document> candidates = new ArrayList<>(List.of(
                doc("c1", "101", "第一段：睑板腺功能障碍是干眼的主要原因。", 0.91),
                doc("c2", "102", "第二段：泪膜破裂时间缩短提示泪膜不稳定。", 0.83),
                doc("c3", "103", "第三段：这段不应交给模型。", 0.72),
                doc("c4", "104", "第四段：这段也不应交给模型。", 0.61)));
        when(vectorStore.similaritySearch(any(SearchRequest.class))).thenReturn(candidates);

        String output = tool.searchDocuments("干眼", 42L);

        assertTrue(output.contains("第一段"));
        assertTrue(output.contains("第二段"));
        assertFalse(output.contains("第三段"), "超出 finalTopK 的候选不能出现在模型上下文里");
        assertFalse(output.contains("第四段"));

        List<ResourceRef> refs = ToolResourceContext.drain();
        assertEquals(2, refs.size(), "侧栏来源数必须等于交给模型的片段数，而不是检索候选数");
        assertEquals(List.of("101", "102"), refs.stream().map(ResourceRef::documentId).toList(),
                "顺序也要与模型看到的一致");
        assertEquals(0.91, refs.get(0).score());
        assertEquals(0.83, refs.get(1).score());
        assertNull(refs.get(0).retrievalScore(), "没有 rerank 时只有一个分数");
    }

    /** rerank 改序后：顺序跟随重排序，score 是重排序分，retrievalScore 才是原始检索分。 */
    @Test
    void rerankReorderKeepsCitationsAlignedAndSplitsScoreSemantics() {
        setField(tool, "rerankEnabled", true);
        Document first = doc("c1", "101", "第一段：检索排第一。", 0.92);
        Document second = doc("c2", "102", "第二段：检索排第二。", 0.81);
        Document third = doc("c3", "103", "第三段：检索排第三。", 0.70);
        when(vectorStore.similaritySearch(any(SearchRequest.class)))
                .thenReturn(new ArrayList<>(List.of(first, second, third)));
        // 重排序把第三段顶到第一，第二段落到最后，并丢掉一个。
        when(rerankModel.call(any(RerankRequest.class))).thenReturn(responseOf(
                scored(third, 0.97),
                scored(first, 0.52)));

        String output = tool.searchDocuments("干眼", 42L);

        int p3 = output.indexOf("第三段");
        int p1 = output.indexOf("第一段");
        assertTrue(p3 >= 0 && p1 >= 0, "两段都应交给模型");
        assertTrue(p3 < p1, "交给模型的文本必须按重排序后的顺序");
        assertFalse(output.contains("第二段"), "被 rerank 丢弃的候选不能出现在正文里");
        assertTrue(output.contains("(相关度: 0.97)"), "正文里的分数是重排序分");

        List<ResourceRef> refs = ToolResourceContext.drain();
        assertEquals(List.of("103", "101"), refs.stream().map(ResourceRef::documentId).toList(),
                "侧栏来源顺序必须与模型正文一致");
        assertEquals(0.97, refs.get(0).score(), "最终排序分 = 重排序分");
        assertEquals(0.70, refs.get(0).retrievalScore(), "原始检索分单独保留");
        assertEquals(0.52, refs.get(1).score());
        assertEquals(0.92, refs.get(1).retrievalScore());
    }

    /** rerank 抛错：回退到原始检索顺序，分数如实标成检索分，不冒充重排序分。 */
    @Test
    void rerankFailureFallsBackToRetrievalOrderWithoutFakingRerankScores() {
        setField(tool, "rerankEnabled", true);
        Document first = doc("c1", "101", "第一段：检索排第一。", 0.90);
        Document second = doc("c2", "102", "第二段：检索排第二。", 0.80);
        Document third = doc("c3", "103", "第三段：检索排第三。", 0.70);
        Document fourth = doc("c4", "104", "第四段：超出 finalTopK。", 0.60);
        when(vectorStore.similaritySearch(any(SearchRequest.class)))
                .thenReturn(new ArrayList<>(List.of(first, second, third, fourth)));
        when(rerankModel.call(any(RerankRequest.class)))
                .thenThrow(new IllegalStateException("rerank 服务不可达"));

        String output = tool.searchDocuments("干眼", 42L);

        assertTrue(output.contains("第一段"));
        assertFalse(output.contains("第四段"), "回退路径同样受 finalTopK 约束");
        assertFalse(output.contains("(相关度:"), "回退后不能把检索分印成重排序分");

        List<ResourceRef> refs = ToolResourceContext.drain();
        assertEquals(List.of("101", "102", "103"), refs.stream().map(ResourceRef::documentId).toList());
        assertEquals(0.90, refs.get(0).score(), "回退时 score 就是检索分");
        assertNull(refs.get(0).retrievalScore(), "回退时不存在独立的原始检索分");
    }

    /** rerank 返回空结果与抛错同等对待：回退，不登记空来源。 */
    @Test
    void emptyRerankResponseFallsBackToRetrievalResults() {
        setField(tool, "rerankEnabled", true);
        Document first = doc("c1", "101", "第一段。", 0.88);
        Document second = doc("c2", "102", "第二段。", 0.77);
        when(vectorStore.similaritySearch(any(SearchRequest.class)))
                .thenReturn(new ArrayList<>(List.of(first, second)));
        when(rerankModel.call(any(RerankRequest.class))).thenReturn(new RerankResponse(List.of()));

        String output = tool.searchDocuments("干眼", 42L);

        assertTrue(output.contains("第一段"));
        List<ResourceRef> refs = ToolResourceContext.drain();
        assertEquals(List.of("101", "102"), refs.stream().map(ResourceRef::documentId).toList());
        assertEquals(0.88, refs.get(0).score());
        assertNull(refs.get(0).retrievalScore());
    }

    /** rerank 某条没给分：这条的得分退回检索分，也不记录重复的「原始分」。 */
    @Test
    void rerankResultWithoutScoreDoesNotInventTwoScores() {
        setField(tool, "rerankEnabled", true);
        Document first = doc("c1", "101", "第一段。", 0.86);
        when(vectorStore.similaritySearch(any(SearchRequest.class)))
                .thenReturn(new ArrayList<>(List.of(first)));
        DocumentWithScore noScore = DocumentWithScore.builder().withDocument(first).build();
        when(rerankModel.call(any(RerankRequest.class))).thenReturn(responseOf(noScore));

        tool.searchDocuments("干眼", 42L);

        List<ResourceRef> refs = ToolResourceContext.drain();
        assertEquals(1, refs.size());
        assertEquals(0.86, refs.get(0).score());
        assertNull(refs.get(0).retrievalScore());
    }

    /** 一条命中既没有 rerank 也没有 finalTopK 之外的候选时，来源仍可核验。 */
    @Test
    void citationWithoutDocIdIsNotRegisteredButStillShownToTheModel() {
        Document noDocId = Document.builder()
                .id("c9")
                .text("没有来源标识的片段。")
                .metadata(Map.of("title", "无来源"))
                .score(0.66)
                .build();
        when(vectorStore.similaritySearch(any(SearchRequest.class)))
                .thenReturn(new ArrayList<>(List.of(noDocId)));

        String output = tool.searchDocuments("干眼", 42L);

        assertTrue(output.contains("没有来源标识的片段"));
        assertEquals(List.of(), ToolResourceContext.drain(), "不可核验的片段不进资源栏");
    }

    private static Document doc(String id, String docId, String text, double score) {
        return Document.builder()
                .id(id)
                .text(text)
                .metadata(Map.of("docId", docId, "title", "文档 " + docId))
                .score(score)
                .build();
    }

    /** 片段级证据：序号从元数据读；同一文档两段各占一条资源。 */
    @Test
    void citationKeepsChunkIdentitySoTwoChunksOfOneDocumentStayDistinct() {
        Document first = Document.builder()
                .id("doc_101_v1_chunk_0")
                .text("第一段。" )
                .metadata(Map.of("docId", "101", "title", "共识", "chunkIndex", 0))
                .score(0.9)
                .build();
        Document second = Document.builder()
                .id("doc_101_v1_chunk_4")
                .text("第四段。")
                .metadata(Map.of("docId", "101", "title", "共识", "chunkIndex", 4))
                .score(0.8)
                .build();
        when(vectorStore.similaritySearch(any(SearchRequest.class)))
                .thenReturn(new ArrayList<>(List.of(first, second)));

        String output = tool.searchDocuments("干眼", 42L);

        List<ResourceRef> refs = ToolResourceContext.drain();
        assertEquals(2, refs.size(), "同一文档的两段是两条证据，不能按文档去重");
        assertEquals(List.of("doc:101#0", "doc:101#4"), refs.stream().map(ResourceRef::id).toList());
        assertEquals(List.of(0, 4), refs.stream().map(ResourceRef::chunkIndex).toList());
        assertEquals("doc_101_v1_chunk_0", refs.get(0).chunkId());
        assertEquals("101#0", refs.get(0).evidenceKey());
        assertTrue(output.contains("(证据: 101#0)"), "交给模型的文本要带可引用句柄");
        assertTrue(output.contains("(证据: 101#4)"));
    }

    /** 已入索引的旧数据没有 chunkIndex 元数据：从稳定分块 id 末尾解析，不要求重灌。 */
    @Test
    void chunkIndexIsParsedFromStableChunkIdWhenMetadataIsMissing() {
        Document builtin = Document.builder()
                .id("builtin_dry-eye_chunk_7")
                .text("内置语料片段。")
                .metadata(Map.of("docId", "builtin:dry-eye", "title", "内置"))
                .score(0.9)
                .build();
        when(vectorStore.similaritySearch(any(SearchRequest.class)))
                .thenReturn(new ArrayList<>(List.of(builtin)));

        tool.searchDocuments("干眼", 42L);

        List<ResourceRef> refs = ToolResourceContext.drain();
        assertEquals(1, refs.size());
        assertEquals(7, refs.get(0).chunkIndex());
        assertEquals("builtin:dry-eye#7", refs.get(0).evidenceKey());
    }

    /** 既没有元数据、id 也不以序号结尾：不给片段粒度，不猜序号。 */
    @Test
    void chunkIndexStaysNullWhenNeitherMetadataNorIdCarriesIt() {
        Document legacy = Document.builder()
                .id("legacy-chunk")
                .text("旧格式片段。")
                .metadata(Map.of("docId", "101", "title", "旧"))
                .score(0.9)
                .build();
        when(vectorStore.similaritySearch(any(SearchRequest.class)))
                .thenReturn(new ArrayList<>(List.of(legacy)));

        tool.searchDocuments("干眼", 42L);

        ResourceRef ref = ToolResourceContext.drain().get(0);
        assertNull(ref.chunkIndex());
        assertEquals("doc:101", ref.id(), "拿不到序号时退回文档级 id");
        assertNull(ref.evidenceKey(), "没有序号就不是可核验证据");
    }

    private static DocumentWithScore scored(Document document, double score) {
        return DocumentWithScore.builder().withDocument(document).withScore(score).build();
    }

    private static RerankResponse responseOf(DocumentWithScore... documents) {
        return new RerankResponse(List.of(documents));
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
