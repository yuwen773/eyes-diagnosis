package com.csust.eyediagnosis.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.mapper.KnowledgeDocumentMapper;
import com.csust.eyediagnosis.manager.CosManager;
import com.csust.eyediagnosis.model.dto.knowledge.KnowledgeUploadRequest;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.IOException;
import java.util.Set;
import java.util.UUID;

@Slf4j
@Service
public class KnowledgeBaseServiceImpl extends ServiceImpl<KnowledgeDocumentMapper, KnowledgeDocument>
        implements com.csust.eyediagnosis.service.KnowledgeBaseService {

    private static final Set<String> ALLOWED_TYPES = Set.of("pdf", "doc", "docx", "txt", "md", "markdown");

    @Resource
    private CosManager cosManager;

    @Resource
    private DocumentProcessingService documentProcessingService;

    @Override
    public Long uploadDocument(KnowledgeUploadRequest request, Long userId) {
        MultipartFile file = request.getFile();
        String originalFilename = file.getOriginalFilename();
        String fileType = getFileType(originalFilename);

        File tempFile = null;
        try {
            tempFile = File.createTempFile("upload_", originalFilename);
            file.transferTo(tempFile);

            // 计算 contentHash 用于去重
            String contentHash = documentProcessingService.computeContentHash(tempFile);

            // 检查相同用户是否已上传相同内容
            KnowledgeDocument existing = baseMapper.selectList(
                    new com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<KnowledgeDocument>()
                            .eq(KnowledgeDocument::getUserId, userId)
                            .eq(KnowledgeDocument::getContentHash, contentHash)
                            .eq(KnowledgeDocument::getIsDelete, 0)
                            .last("LIMIT 1")
            ).stream().findFirst().orElse(null);

            if (existing != null) {
                throw new BusinessException(ErrorCode.PARAMS_ERROR, "文档已存在，请勿重复上传");
            }

            String storedFileName = UUID.randomUUID() + "_" + originalFilename;
            cosManager.putObject(storedFileName, tempFile);

            KnowledgeDocument doc = new KnowledgeDocument();
            doc.setUserId(userId);
            doc.setTitle(request.getTitle() != null ? request.getTitle() : originalFilename);
            doc.setFileName(originalFilename);
            doc.setFileUrl(storedFileName);
            doc.setFileSize(file.getSize());
            doc.setFileType(fileType);
            doc.setContentHash(contentHash);
            doc.setStatus(0);
            baseMapper.insert(doc);

            // 通过 Spring 代理调用，@Async 生效
            documentProcessingService.processDocument(doc.getId(), tempFile, fileType, doc.getTitle());

            return doc.getId();
        } catch (IOException e) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "文件上传失败");
        }
    }

    @Override
    public void deleteDocument(Long documentId, Long userId) {
        KnowledgeDocument doc = baseMapper.selectById(documentId);
        if (doc == null) throw new BusinessException(ErrorCode.NOT_FOUND_ERROR);
        if (doc.getIsDelete() != null && doc.getIsDelete() == 1) {
            throw new BusinessException(ErrorCode.NOT_FOUND_ERROR, "文档已被删除");
        }
        if (!doc.getUserId().equals(userId)) throw new BusinessException(ErrorCode.NO_AUTH_ERROR);

        // Delete vectors from ChromaDB
        if (doc.getChunkCount() != null && doc.getChunkCount() > 0) {
            try {
                var vectorStore = documentProcessingService.getVectorStore();
                if (vectorStore != null) {
                    var chunkIds = new java.util.ArrayList<String>();
                    for (int i = 0; i < doc.getChunkCount(); i++) {
                        chunkIds.add("doc_" + documentId + "_chunk_" + i);
                    }
                    vectorStore.delete(chunkIds);
                }
            } catch (Exception e) {
                log.warn("向量删除失败，继续删除数据库记录: docId={}", documentId, e);
            }
        }

        doc.setIsDelete(1);
        baseMapper.updateById(doc);
    }

    @Override
    public void updateDocument(Long documentId, MultipartFile file, String title, Long userId) {
        KnowledgeDocument doc = baseMapper.selectById(documentId);
        if (doc == null) throw new BusinessException(ErrorCode.NOT_FOUND_ERROR);
        if (doc.getIsDelete() != null && doc.getIsDelete() == 1) {
            throw new BusinessException(ErrorCode.NOT_FOUND_ERROR, "文档已被删除");
        }
        if (!doc.getUserId().equals(userId)) throw new BusinessException(ErrorCode.NO_AUTH_ERROR);

        // 1. 删除旧向量
        if (doc.getChunkCount() != null && doc.getChunkCount() > 0) {
            try {
                var vectorStore = documentProcessingService.getVectorStore();
                if (vectorStore != null) {
                    var chunkIds = new java.util.ArrayList<String>();
                    for (int i = 0; i < doc.getChunkCount(); i++) {
                        chunkIds.add("doc_" + documentId + "_chunk_" + i);
                    }
                    vectorStore.delete(chunkIds);
                }
            } catch (Exception e) {
                log.warn("旧向量删除失败: docId={}", documentId, e);
            }
        }

        // 2. 上传新文件到 COS
        String originalFilename = file.getOriginalFilename();
        String fileType = getFileType(originalFilename);
        File tempFile = null;
        try {
            tempFile = File.createTempFile("update_", originalFilename);
            file.transferTo(tempFile);

            String storedFileName = UUID.randomUUID() + "_" + originalFilename;
            cosManager.putObject(storedFileName, tempFile);

            // 3. 更新数据库记录
            doc.setFileName(originalFilename);
            doc.setFileUrl(storedFileName);
            doc.setFileSize(file.getSize());
            doc.setFileType(fileType);
            doc.setTitle(title != null ? title : originalFilename);
            doc.setStatus(0);
            doc.setChunkCount(null);
            baseMapper.updateById(doc);

            // 4. 异步重新处理文档
            documentProcessingService.processDocument(doc.getId(), tempFile, fileType, doc.getTitle());
        } catch (IOException e) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "文件更新失败");
        }
    }

    private String getFileType(String filename) {
        if (filename == null) throw new BusinessException(ErrorCode.PARAMS_ERROR, "文件名不能为空");
        int lastDot = filename.lastIndexOf('.');
        if (lastDot <= 0) throw new BusinessException(ErrorCode.PARAMS_ERROR, "无法识别文件类型");
        String type = filename.substring(lastDot + 1).toLowerCase();
        if (!ALLOWED_TYPES.contains(type)) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "不支持的文件类型: " + type + "，支持: " + ALLOWED_TYPES);
        }
        return type;
    }
}