package com.csust.eyediagnosis.service.impl;

import com.csust.eyediagnosis.agent.rag.DocumentParser;
import com.csust.eyediagnosis.agent.rag.EmbeddingBatchWriter;
import com.csust.eyediagnosis.agent.rag.SourceTypePolicy;
import com.csust.eyediagnosis.agent.rag.TextChunkerService;
import com.csust.eyediagnosis.mapper.KnowledgeDocumentMapper;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.ai.vectorstore.filter.Filter;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
public class DocumentProcessingService {

    @Resource
    private DocumentParser documentParser;

    @Resource
    private TextChunkerService textChunkerService;

    @Autowired(required = false)
    private VectorStore vectorStore;

    @Resource
    private KnowledgeDocumentMapper knowledgeDocumentMapper;

    public VectorStore getVectorStore() {
        return vectorStore;
    }

    public String computeContentHash(File file) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(Files.readAllBytes(file.toPath()));
            StringBuilder hex = new StringBuilder();
            for (byte b : hash) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (NoSuchAlgorithmException | IOException e) {
            throw new RuntimeException("计算文件哈希失败", e);
        }
    }

    @Async("documentProcessingExecutor")
    public void processDocument(Long docId, File file, String fileType, String title) {
        log.info("[ETL] 开始处理文档: docId={}, file={}, fileType={}, title={}", docId, file.getAbsolutePath(), fileType, title);
        long startTime = System.currentTimeMillis();
        try {
            // ========== 1. Extract ==========
            String fileUrl = file.getAbsolutePath();
            log.info("[ETL-Extract] 开始解析文档: fileUrl={}", fileUrl);
            long extractStart = System.currentTimeMillis();
            List<String> paragraphs = documentParser.parse(fileUrl, fileType);
            log.info("[ETL-Extract] 文档解析完成: docId={}, 段落数={}, 耗时={}ms", docId, paragraphs.size(), System.currentTimeMillis() - extractStart);
            if (paragraphs.isEmpty()) throw new RuntimeException("文档内容为空");

            // ========== 2. Transform ==========
            log.info("[ETL-Transform] 开始合并文本并构建 metadata");
            long transformStart = System.currentTimeMillis();
            String rawText = paragraphs.stream().reduce("", (a, b) -> a + "\n\n" + b).trim();
            log.info("[ETL-Transform] 文本合并完成: docId={}, 原始文本长度={}字符", docId, rawText.length());

            // 查询文档的 owner（上传用户 id），用于写入向量元数据实现检索隔离
            KnowledgeDocument knowledgeDocument = knowledgeDocumentMapper.selectById(docId);
            if (knowledgeDocument == null) {
                throw new RuntimeException("文档不存在: docId=" + docId);
            }

            // 构建 metadata（含可信 ownerUserId / documentId）
            Map<String, Object> metadata = documentParser.buildMetadata(rawText, fileUrl, title, fileType);
            metadata.put("docId", docId.toString());
            metadata.put("documentId", docId);
            metadata.put("ownerUserId", knowledgeDocument.getUserId());
            // Server-derived source marker. Never accepts a client-supplied value.
            metadata.put(SourceTypePolicy.METADATA_KEY, SourceTypePolicy.SourceType.USER_UPLOAD.wire());
            log.info("[ETL-Transform] Metadata 构建完成: docId={}, metadata={}", docId, metadata);

            // 文本分块
            log.info("[ETL-Transform] 开始文本分块: docId={}, 策略=512词滑动窗口", docId);
            List<Document> chunks = textChunkerService.chunk(rawText, metadata);
            log.info("[ETL-Transform] 文本分块完成: docId={}, chunk数量={}, 耗时={}ms", docId, chunks.size(), System.currentTimeMillis() - transformStart);

            // 为每个 chunk 设置唯一 ID 并确保 metadata 包含 ownerUserId。
            // 这里构建新列表而不是原地 set()：chunk() 的返回值可能是不可变列表
            // （List.of / stream().toList()），原地修改会抛 UnsupportedOperationException，
            // 再被下面的 catch 吞成 error=null，整份文档静默处理失败。
            List<Document> ownedChunks = new ArrayList<>(chunks.size());
            for (int i = 0; i < chunks.size(); i++) {
                Document chunk = chunks.get(i);
                String chunkId = "doc_" + docId + "_chunk_" + i;
                Map<String, Object> chunkMetadata = new HashMap<>(chunk.getMetadata());
                chunkMetadata.put("ownerUserId", knowledgeDocument.getUserId());
                chunkMetadata.put("documentId", docId);
                // Re-stamp on every rebuilt chunk so no chunk can miss the marker.
                chunkMetadata.put(SourceTypePolicy.METADATA_KEY,
                        SourceTypePolicy.SourceType.USER_UPLOAD.wire());
                ownedChunks.add(new Document(chunkId, chunk.getText(), chunkMetadata));
                log.debug("[ETL-Transform] Chunk[{}]: id={}, text长度={}", i, chunkId, chunk.getText().length());
            }
            chunks = ownedChunks;

            // ========== 3. Load ==========
            log.info("[ETL-Load] 开始存储到向量数据库: docId={}, chunk数量={}", docId, chunks.size());
            long loadStart = System.currentTimeMillis();
            if (vectorStore != null) {
                try {
                    EmbeddingBatchWriter.add(vectorStore, chunks);
                } catch (RuntimeException e) {
                    // 分批写不是原子的：第 2 批失败时第 1 批已经进了向量库，
                    // 而 MySQL 会把文档标成失败。半份文档不能作为「来源」被引用——
                    // 先把已写入的片段清掉；清理失败也照样标记失败，检索侧另有就绪校验兜底。
                    purgeVectors(docId);
                    throw e;
                }
                log.info("[ETL-Load] 向量存储完成: docId={}, 耗时={}ms", docId, System.currentTimeMillis() - loadStart);
            } else {
                log.warn("[ETL-Load] VectorStore 未配置，跳过向量存储: docId={}", docId);
            }

            // 更新状态
            updateStatus(docId, 1, chunks.size());
            log.info("[ETL] 文档处理完成: docId={}, chunkCount={}, 总耗时={}ms", docId, chunks.size(), System.currentTimeMillis() - startTime);
        } catch (Exception e) {
            log.error("[ETL] 文档处理失败: docId={}, 耗时={}ms, error={}", docId, System.currentTimeMillis() - startTime, e.getMessage(), e);
            // 失败文档不留可检索的残片（幂等：成功路径已清过就再清一次也无害）。
            purgeVectors(docId);
            updateStatus(docId, 2, null);
        } finally {
            if (file != null && file.exists()) {
                if (!file.delete()) {
                    log.warn("[ETL] 临时文件删除失败: {}", file.getAbsolutePath());
                } else {
                    log.debug("[ETL] 临时文件已删除: {}", file.getAbsolutePath());
                }
            }
        }
    }

    /**
     * 按 documentId 元数据删除某个文档的全部分块。
     *
     * <p>不能靠 {@code chunkCount}：失败文档恰恰没有写这个字段，用计数拼 chunkId
     * 会一个也删不掉。这里按元数据删除，重试一次；仍失败也不抛——正确性由
     * 检索侧的「文档就绪」校验保证，这里的清理只是为了不留垃圾。
     */
    void purgeVectors(Long docId) {
        if (vectorStore == null || docId == null) return;
        for (int attempt = 1; attempt <= 2; attempt++) {
            try {
                vectorStore.delete(new Filter.Expression(
                        Filter.ExpressionType.EQ,
                        new Filter.Key("documentId"),
                        new Filter.Value(docId)));
                log.info("[ETL] 已清理文档残留向量: docId={}, attempt={}", docId, attempt);
                return;
            } catch (Exception e) {
                log.warn("[ETL] 残留向量清理失败（第 {} 次）: docId={}", attempt, docId, e.getMessage());
            }
        }
    }

    private void updateStatus(Long docId, int status, Integer chunkCount) {
        KnowledgeDocument update = new KnowledgeDocument();
        update.setId(docId);
        update.setStatus(status);
        if (chunkCount != null) {
            update.setChunkCount(chunkCount);
        }
        knowledgeDocumentMapper.updateById(update);
    }
}