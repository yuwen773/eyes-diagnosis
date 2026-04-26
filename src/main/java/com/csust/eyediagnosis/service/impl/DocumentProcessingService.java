package com.csust.eyediagnosis.service.impl;

import com.csust.eyediagnosis.agent.rag.DocumentParser;
import com.csust.eyediagnosis.agent.rag.TextChunkerService;
import com.csust.eyediagnosis.mapper.KnowledgeDocumentMapper;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
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

    @Async("agentAsyncExecutor")
    public void processDocument(Long docId, File file, String fileType, String title) {
        try {
            String fileUrl = file.getAbsolutePath();
            List<String> paragraphs = documentParser.parse(fileUrl, fileType);
            if (paragraphs.isEmpty()) throw new RuntimeException("文档内容为空");

            String rawText = paragraphs.stream().reduce("", (a, b) -> a + "\n\n" + b).trim();

            // 构建丰富的 metadata
            Map<String, Object> metadata = documentParser.buildMetadata(rawText, fileUrl, title, fileType);
            metadata.put("docId", docId.toString());

            List<Document> chunks = textChunkerService.chunk(rawText, metadata);

            for (int i = 0; i < chunks.size(); i++) {
                String chunkId = "doc_" + docId + "_chunk_" + i;
                chunks.set(i, new Document(chunkId, chunks.get(i).getText(), chunks.get(i).getMetadata()));
            }

            if (vectorStore != null) {
                vectorStore.add(chunks);
            }

            updateStatus(docId, 1, chunks.size());
        } catch (Exception e) {
            log.error("文档处理失败: docId={}", docId, e);
            updateStatus(docId, 2, null);
        } finally {
            if (file != null && file.exists()) {
                if (!file.delete()) {
                    log.warn("临时文件删除失败: {}", file.getAbsolutePath());
                }
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