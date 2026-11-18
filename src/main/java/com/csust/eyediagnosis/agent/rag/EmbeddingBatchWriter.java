package com.csust.eyediagnosis.agent.rag;

import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.VectorStore;

import java.util.List;

/**
 * 向量写入的分批器。
 *
 * <p>DashScope 的文本嵌入接口一次最多接受 10 条输入，超了直接 400
 * （{@code Value error, batch size is invalid, it should not be larger than 10}）。
 * 一篇长文档或整份内置语料很容易超过 10 个分块，所以写入必须分批——
 * 否则知识库「看起来上传成功」但一个分块都没进向量库。
 */
public final class EmbeddingBatchWriter {

    /** DashScope text-embedding-v3 单次请求的文本条数上限。 */
    public static final int MAX_BATCH_SIZE = 10;

    private EmbeddingBatchWriter() {
    }

    public static void add(VectorStore store, List<Document> documents) {
        if (store == null || documents == null || documents.isEmpty()) {
            return;
        }
        for (int from = 0; from < documents.size(); from += MAX_BATCH_SIZE) {
            int to = Math.min(documents.size(), from + MAX_BATCH_SIZE);
            store.add(documents.subList(from, to));
        }
    }
}
