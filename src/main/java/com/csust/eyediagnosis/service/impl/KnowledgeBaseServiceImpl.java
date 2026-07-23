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
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Slf4j
@Service
public class KnowledgeBaseServiceImpl extends ServiceImpl<KnowledgeDocumentMapper, KnowledgeDocument>
        implements com.csust.eyediagnosis.service.KnowledgeBaseService {

    private static final Set<String> ALLOWED_TYPES = Set.of("pdf", "doc", "docx", "txt", "md", "markdown");

    @Resource
    private CosManager cosManager;

    @Resource
    private DocumentProcessingService documentProcessingService;

    private final ExecutorService uploadExecutor = Executors.newFixedThreadPool(
            Math.max(2, Runtime.getRuntime().availableProcessors() / 2));

    @Override
    public List<Long> uploadDocument(KnowledgeUploadRequest request, Long userId) {
        MultipartFile[] files = request.getFiles();
        if (files == null || files.length == 0) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "请选择至少一个文件");
        }

        List<String> failedFiles = new ArrayList<>();
        String title = request.getTitle();

        List<CompletableFuture<UploadResult>> futures = new ArrayList<>(files.length);
        for (MultipartFile file : files) {
            String originalFilename = file.getOriginalFilename();
            String fileType;
            try {
                fileType = getFileType(originalFilename);
            } catch (BusinessException e) {
                failedFiles.add(originalFilename + "（" + e.getMessage() + "）");
                continue;
            }

            futures.add(CompletableFuture.supplyAsync(() -> {
                File tempFile = null;
                try {
                    tempFile = File.createTempFile("upload_", originalFilename);
                    file.transferTo(tempFile);

                    String contentHash = documentProcessingService.computeContentHash(tempFile);

                    KnowledgeDocument existing = baseMapper.selectList(
                            new com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<KnowledgeDocument>()
                                    .eq(KnowledgeDocument::getUserId, userId)
                                    .eq(KnowledgeDocument::getContentHash, contentHash)
                                    .last("LIMIT 1")
                    ).stream().findFirst().orElse(null);

                    if (existing != null) {
                        return new UploadResult(null, originalFilename, "文档已存在");
                    }

                    String storedFileName = UUID.randomUUID() + "_" + originalFilename;
                    cosManager.putObject(storedFileName, tempFile);

                    KnowledgeDocument doc = new KnowledgeDocument();
                    doc.setUserId(userId);
                    doc.setTitle(title != null ? title : originalFilename);
                    doc.setFileName(originalFilename);
                    doc.setFileUrl(storedFileName);
                    doc.setFileSize(file.getSize());
                    doc.setFileType(fileType);
                    doc.setContentHash(contentHash);
                    doc.setStatus(0);
                    baseMapper.insert(doc);

                    documentProcessingService.processDocument(doc.getId(), tempFile, fileType, doc.getTitle());
                    return new UploadResult(doc.getId(), originalFilename, null);
                } catch (IOException e) {
                    log.error("文件上传失败: filename={}", originalFilename, e);
                    return new UploadResult(null, originalFilename, "上传失败");
                }
            }, uploadExecutor));
        }

        List<Long> successIds = new ArrayList<>();
        for (CompletableFuture<UploadResult> future : futures) {
            try {
                UploadResult result = future.join();
                if (result.docId() != null) {
                    successIds.add(result.docId());
                } else {
                    failedFiles.add(result.filename() + "（" + result.error() + "）");
                }
            } catch (Exception e) {
                log.error("批量上传结果收集异常", e);
            }
        }

        if (!failedFiles.isEmpty()) {
            log.warn("批量上传部分文件失败: {}", failedFiles);
        }

        if (successIds.isEmpty() && !failedFiles.isEmpty()) {
            throw new BusinessException(ErrorCode.OPERATION_ERROR, "全部文件上传失败: " + String.join(", ", failedFiles));
        }

        return successIds;
    }

    @Override
    public void deleteDocument(Long documentId, Long userId) {
        KnowledgeDocument doc = baseMapper.selectById(documentId);
        if (doc == null) throw new BusinessException(ErrorCode.NOT_FOUND_ERROR);
        if (doc.getIsDelete() != null && doc.getIsDelete() == 1) {
            throw new BusinessException(ErrorCode.NOT_FOUND_ERROR, "文档已被删除");
        }
        if (!doc.getUserId().equals(userId)) throw new BusinessException(ErrorCode.NO_AUTH_ERROR);

        if (doc.getChunkCount() != null && doc.getChunkCount() > 0) {
            try {
                var vectorStore = documentProcessingService.getVectorStore();
                if (vectorStore != null) {
                    vectorStore.delete(buildChunkIds(documentId, doc.getChunkCount()));
                }
            } catch (Exception e) {
                log.warn("向量删除失败，继续删除数据库记录: docId={}", documentId, e);
            }
        }

        try {
            cosManager.deleteObject(doc.getFileUrl());
        } catch (Exception e) {
            log.warn("COS delete failed, will retry via compensation: docId={}", documentId, e);
        }

        baseMapper.deleteById(doc);
    }

    @Override
    public void updateDocument(Long documentId, MultipartFile file, String title, Long userId) {
        KnowledgeDocument doc = baseMapper.selectById(documentId);
        if (doc == null) throw new BusinessException(ErrorCode.NOT_FOUND_ERROR);
        if (doc.getIsDelete() != null && doc.getIsDelete() == 1) {
            throw new BusinessException(ErrorCode.NOT_FOUND_ERROR, "文档已被删除");
        }
        if (!doc.getUserId().equals(userId)) throw new BusinessException(ErrorCode.NO_AUTH_ERROR);

        if (doc.getChunkCount() != null && doc.getChunkCount() > 0) {
            try {
                var vectorStore = documentProcessingService.getVectorStore();
                if (vectorStore != null) {
                    vectorStore.delete(buildChunkIds(documentId, doc.getChunkCount()));
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

    private List<String> buildChunkIds(Long docId, int chunkCount) {
        List<String> chunkIds = new ArrayList<>(chunkCount);
        for (int i = 0; i < chunkCount; i++) {
            chunkIds.add("doc_" + docId + "_chunk_" + i);
        }
        return chunkIds;
    }

    private record UploadResult(Long docId, String filename, String error) {}
}