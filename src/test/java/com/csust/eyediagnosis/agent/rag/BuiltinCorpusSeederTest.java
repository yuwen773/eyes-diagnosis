package com.csust.eyediagnosis.agent.rag;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class BuiltinCorpusSeederTest {

    private static final int BUILTIN_DOCUMENT_COUNT = 8;

    @Mock
    private VectorStore vectorStore;

    @Captor
    private ArgumentCaptor<List<Document>> documentsCaptor;

    private BuiltinCorpusSeeder seeder;

    @BeforeEach
    void setUp() {
        TextChunkerService chunker = new TextChunkerService();
        ReflectionTestUtils.setField(chunker, "chunkSize", 800);
        ReflectionTestUtils.setField(chunker, "chunkOverlap", 100);

        seeder = new BuiltinCorpusSeeder();
        ReflectionTestUtils.setField(seeder, "vectorStore", vectorStore);
        ReflectionTestUtils.setField(seeder, "textChunkerService", chunker);
    }

    @Test
    void seedsEveryBuiltinDocumentWithSystemOwner() {
        when(vectorStore.similaritySearch(any(SearchRequest.class))).thenReturn(List.of());

        int chunks = seeder.seed();

        assertTrue(chunks > 0, "内置语料应当产生分块");
        // 嵌入接口一次只收 10 条，写入是分多批的：把所有批合起来看。
        verify(vectorStore, atLeastOnce()).add(documentsCaptor.capture());
        List<Document> documents = documentsCaptor.getAllValues().stream()
                .flatMap(List::stream)
                .toList();
        assertEquals(chunks, documents.size());

        Set<String> sources = documents.stream()
                .map(document -> (String) document.getMetadata().get("source"))
                .collect(Collectors.toSet());
        assertEquals(BUILTIN_DOCUMENT_COUNT, sources.size(), "应当播下全部内置语料文件");

        for (Document document : documents) {
            assertEquals(BuiltinCorpus.SYSTEM_OWNER_ID, document.getMetadata().get("ownerUserId"));
            assertEquals(BuiltinCorpus.CORPUS_TAG, document.getMetadata().get("corpus"));
            assertTrue(document.getId().startsWith("builtin_"), "分块 id 需要稳定: " + document.getId());
        }
        // 任何一批都不能超过嵌入接口的上限。
        assertTrue(documentsCaptor.getAllValues().stream()
                        .allMatch(batch -> batch.size() <= EmbeddingBatchWriter.MAX_BATCH_SIZE),
                "单批不得超过嵌入接口上限");
    }

    @Test
    void chunkIdsAreStableAcrossSeeds() {
        when(vectorStore.similaritySearch(any(SearchRequest.class))).thenReturn(List.of());

        ArgumentCaptor<List<Document>> firstCaptor = ArgumentCaptor.forClass(List.class);
        seeder.seed();
        verify(vectorStore, atLeastOnce()).add(firstCaptor.capture());
        List<String> firstRun = firstCaptor.getAllValues().stream()
                .flatMap(List::stream)
                .map(Document::getId)
                .toList();

        // 只看第二次播种的写入：清掉调用记录，stubbing 仍然有效。
        clearInvocations(vectorStore);
        ArgumentCaptor<List<Document>> secondCaptor = ArgumentCaptor.forClass(List.class);
        seeder.seed();
        verify(vectorStore, atLeastOnce()).add(secondCaptor.capture());
        List<String> secondRun = secondCaptor.getAllValues().stream()
                .flatMap(List::stream)
                .map(Document::getId)
                .toList();

        assertEquals(firstRun, secondRun);
    }

    @Test
    void removesChunksThatNoLongerExistInTheCorpus() {
        // 语料变短后多出来的旧分块：id 不在本次写入的集合里，应当被清掉
        when(vectorStore.similaritySearch(any(SearchRequest.class))).thenReturn(List.of(
                new Document("builtin_01-normal_chunk_9999", "旧内容", Map.of("corpus", "builtin"))));

        seeder.seed();

        verify(vectorStore).delete(List.of("builtin_01-normal_chunk_9999"));
    }

    @Test
    void keepsChunksWhoseIdIsStillInUse() {
        when(vectorStore.similaritySearch(any(SearchRequest.class))).thenReturn(List.of(
                new Document("builtin_01-normal_chunk_0", "旧内容", Map.of("corpus", "builtin"))));

        seeder.seed();

        verify(vectorStore, times(0)).delete(anyList());
    }

    @Test
    void doesNotTouchVectorStoreWhenNoBuiltinResourceIsFound() {
        ReflectionTestUtils.setField(seeder, "resourcePattern", "classpath*:no-such-dir/*.md");

        assertEquals(0, seeder.seed());
        verify(vectorStore, times(0)).add(any());
    }

    @Test
    void builtinFilterKeepsUserDocumentsAndSharedCorpus() {
        // 构造型表达式：雪花 ID 走不到「文本按 Integer 解析」那条会溢出的路径。
        assertOwnerFilter(BuiltinCorpus.ownerFilter(42L), 42L);
        assertOwnerFilter(BuiltinCorpus.ownerFilter(2123010432165113858L), 2123010432165113858L);
    }

    private static void assertOwnerFilter(
            org.springframework.ai.vectorstore.filter.Filter.Expression filter, long ownerId) {
        assertEquals(org.springframework.ai.vectorstore.filter.Filter.ExpressionType.OR, filter.type());
        var left = (org.springframework.ai.vectorstore.filter.Filter.Expression) filter.left();
        var right = (org.springframework.ai.vectorstore.filter.Filter.Expression) filter.right();
        assertEquals("ownerUserId",
                ((org.springframework.ai.vectorstore.filter.Filter.Key) left.left()).key());
        assertEquals(ownerId,
                ((Number) ((org.springframework.ai.vectorstore.filter.Filter.Value) left.right()).value())
                        .longValue());
        assertEquals(0L,
                ((Number) ((org.springframework.ai.vectorstore.filter.Filter.Value) right.right()).value())
                        .longValue());
    }
}
