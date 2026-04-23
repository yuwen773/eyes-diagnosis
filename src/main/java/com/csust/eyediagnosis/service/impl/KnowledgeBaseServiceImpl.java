package com.csust.eyediagnosis.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.mapper.KnowledgeDocumentMapper;
import com.csust.eyediagnosis.manager.CosManager;
import com.csust.eyediagnosis.model.dto.knowledge.KnowledgeUploadRequest;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;
import com.csust.eyediagnosis.agent.rag.DocumentParser;
import com.csust.eyediagnosis.agent.rag.TextChunkerService;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Slf4j
@Service
public class KnowledgeBaseServiceImpl extends ServiceImpl<KnowledgeDocumentMapper, KnowledgeDocument>
        implements com.csust.eyediagnosis.service.KnowledgeBaseService {

    @Resource
    private CosManager cosManager;

    @Resource
    private DocumentParser documentParser;

    @Resource
    private TextChunkerService textChunkerService;

    @Autowired(required = false)
    private VectorStore vectorStore;

    @Override
    public Long uploadDocument(KnowledgeUploadRequest request, Long userId) {
        MultipartFile file = request.getFile();
        String originalFilename = file.getOriginalFilename();
        String fileType = getFileType(originalFilename);

        // Convert MultipartFile to File for COS upload
        File tempFile = null;
        try {
            tempFile = File.createTempFile("upload_", originalFilename);
            file.transferTo(tempFile);

            String storedFileName = UUID.randomUUID() + "_" + originalFilename;
            cosManager.putObject(storedFileName, tempFile);

            // Save document record
            KnowledgeDocument doc = new KnowledgeDocument();
            doc.setUserId(userId);
            doc.setTitle(request.getTitle() != null ? request.getTitle() : originalFilename);
            doc.setFileName(originalFilename);
            doc.setFileUrl(storedFileName); // COS key as URL
            doc.setFileSize(file.getSize());
            doc.setFileType(fileType);
            doc.setStatus(0); // 处理中
            baseMapper.insert(doc);

            // Async: parse, chunk, embed (tempFile deleted inside async after reading)
            asyncProcessDocument(doc.getId(), tempFile, fileType);

            return doc.getId();
        } catch (IOException e) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "文件上传失败");
        }
    }

    @Async
    public void asyncProcessDocument(Long docId, File file, String fileType) {
        try {
            List<String> paragraphs = documentParser.parse(file.getAbsolutePath(), fileType);
            if (paragraphs.isEmpty()) throw new RuntimeException("文档内容为空");

            List<Document> chunks = textChunkerService.chunk(
                    String.join("\n\n", paragraphs),
                    Map.of("docId", docId)
            );

            vectorStore.add(chunks);

            KnowledgeDocument doc = baseMapper.selectById(docId);
            doc.setChunkCount(chunks.size());
            doc.setStatus(1); // 已完成
            baseMapper.updateById(doc);
        } catch (Exception e) {
            log.error("文档处理失败: docId={}", docId, e);
            KnowledgeDocument doc = baseMapper.selectById(docId);
            doc.setStatus(2); // 失败
            baseMapper.updateById(doc);
        } finally {
            if (file != null && file.exists()) {
                file.delete();
            }
        }
    }

    @Override
    public void deleteDocument(Long documentId, Long userId) {
        KnowledgeDocument doc = baseMapper.selectById(documentId);
        if (doc == null) throw new BusinessException(ErrorCode.NOT_FOUND_ERROR);
        if (!doc.getUserId().equals(userId)) throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
        doc.setIsDelete(1);
        baseMapper.updateById(doc);
    }

    private String getFileType(String filename) {
        if (filename == null) return "unknown";
        int lastDot = filename.lastIndexOf('.');
        return lastDot > 0 ? filename.substring(lastDot + 1).toLowerCase() : "unknown";
    }
}
