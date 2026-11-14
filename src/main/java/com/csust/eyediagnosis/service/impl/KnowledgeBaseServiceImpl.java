package com.csust.eyediagnosis.service.impl;

import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.csust.eyediagnosis.agent.rag.DocumentParser;
import com.csust.eyediagnosis.agent.rag.TextChunkerService;
import com.csust.eyediagnosis.common.BatchResultVO;
import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.ThrowUtils;
import com.csust.eyediagnosis.manager.CosManager;
import com.csust.eyediagnosis.mapper.KnowledgeDocumentMapper;
import com.csust.eyediagnosis.model.dto.knowledge.KnowledgeQueryDTO;
import com.csust.eyediagnosis.model.dto.knowledge.KnowledgeUploadRequest;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.knowledge.KnowledgeChunkVO;
import com.csust.eyediagnosis.model.vo.knowledge.KnowledgeDetailVO;
import com.csust.eyediagnosis.utils.DateRanges;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.document.Document;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.IOException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
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

    /** 预览链接的有效期（分钟）。签名链接过期即失效，不做长期放行。 */
    private static final int PRESIGN_MINUTES = 10;

    /** 单次预览最多回传的切片数：切片再多也是给人看的，截断并说明。 */
    private static final int MAX_PREVIEW_CHUNKS = 2000;

    /** 纯文本直读的最大字符数。 */
    private static final int MAX_TEXT_PREVIEW = 4000;

    @Resource
    private CosManager cosManager;

    @Resource
    private DocumentProcessingService documentProcessingService;

    @Resource
    private DocumentParser documentParser;

    @Resource
    private TextChunkerService textChunkerService;

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
    public void deleteDocument(Long documentId, User actor) {
        KnowledgeDocument doc = loadDocument(documentId);
        assertCanManage(doc, actor);
        purgeDocument(doc);
    }

    @Override
    public BatchResultVO deleteDocuments(List<Long> documentIds, User actor) {
        List<Long> targets = normalizeIds(documentIds);
        List<String> failedIds = new ArrayList<>();
        List<String> reasons = new ArrayList<>();
        int succeeded = 0;
        for (Long id : targets) {
            try {
                deleteDocument(id, actor);
                succeeded++;
            } catch (BusinessException e) {
                failedIds.add(String.valueOf(id));
                reasons.add(id + "：" + e.getMessage());
            } catch (Exception e) {
                failedIds.add(String.valueOf(id));
                reasons.add(id + "：删除失败");
                log.error("批量删除知识文档失败: docId={}", id, e);
            }
        }
        String message = reasons.isEmpty()
                ? "已删除 " + succeeded + " 份文档"
                : String.join("；", reasons);
        return new BatchResultVO(targets.size(), succeeded, failedIds, message);
    }

    @Override
    public void updateTitle(Long documentId, String title, User actor) {
        ThrowUtils.throwIf(StrUtil.isBlank(title), ErrorCode.PARAMS_ERROR, "标题不能为空");
        KnowledgeDocument doc = loadDocument(documentId);
        assertCanManage(doc, actor);
        KnowledgeDocument patch = new KnowledgeDocument();
        patch.setId(doc.getId());
        patch.setTitle(title.trim());
        patch.setUpdateTime(LocalDateTime.now());
        int rows = baseMapper.updateById(patch);
        ThrowUtils.throwIf(rows <= 0, ErrorCode.OPERATION_ERROR);
    }

    @Override
    public Page<KnowledgeDocument> pageDocuments(KnowledgeQueryDTO query, User actor) {
        ThrowUtils.throwIf(actor == null, ErrorCode.NO_AUTH_ERROR);
        KnowledgeQueryDTO q = query == null ? new KnowledgeQueryDTO() : query;
        boolean seesAll = DiagnosisServiceImpl.seesAllRecords(actor);

        LambdaQueryWrapper<KnowledgeDocument> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(!seesAll, KnowledgeDocument::getUserId, actor.getId());
        wrapper.like(StrUtil.isNotBlank(q.getFileName()), KnowledgeDocument::getFileName, q.getFileName());
        wrapper.like(StrUtil.isNotBlank(q.getTitle()), KnowledgeDocument::getTitle, q.getTitle());
        wrapper.eq(q.getStatus() != null, KnowledgeDocument::getStatus, q.getStatus());
        wrapper.eq(StrUtil.isNotBlank(q.getFileType()), KnowledgeDocument::getFileType, q.getFileType());
        wrapper.ge(DateRanges.parseLocalDay(q.getStartDate(), false) != null, KnowledgeDocument::getCreateTime,
                DateRanges.parseLocalDay(q.getStartDate(), false));
        wrapper.le(DateRanges.parseLocalDay(q.getEndDate(), true) != null, KnowledgeDocument::getCreateTime,
                DateRanges.parseLocalDay(q.getEndDate(), true));
        wrapper.orderByDesc(KnowledgeDocument::getCreateTime);
        return this.page(new Page<>(q.getCurrent(), q.getPageSize()), wrapper);
    }

    @Override
    public KnowledgeDetailVO getDocumentDetail(Long documentId, User actor) {
        KnowledgeDocument doc = loadDocument(documentId);
        assertCanManage(doc, actor);

        KnowledgeDetailVO vo = new KnowledgeDetailVO();
        vo.setId(doc.getId());
        vo.setTitle(doc.getTitle());
        vo.setFileName(doc.getFileName());
        vo.setFileType(doc.getFileType());
        vo.setFileSize(doc.getFileSize());
        vo.setChunkCount(doc.getChunkCount());
        vo.setStatus(doc.getStatus());
        vo.setUserId(doc.getUserId());
        vo.setCreateTime(doc.getCreateTime());
        vo.setUpdateTime(doc.getUpdateTime());
        vo.setPreviewKind(previewKind(doc.getFileType()));

        // 预览链接：COS 里是私有 key，浏览器拿不到；换成 10 分钟有效的签名 URL。
        try {
            vo.setPreviewUrl(cosManager.generatePresignedUrl(doc.getFileUrl(),
                    Date.from(Instant.now().plus(PRESIGN_MINUTES, ChronoUnit.MINUTES))));
        } catch (Exception e) {
            log.warn("生成预览链接失败: docId={}", doc.getId(), e);
        }

        // 切片：按入库时同一套解析 + 切分规则重放一遍，把「这份文档被切成了什么」
        // 如实摆出来。解析不了（扫描件 PDF、文件已从 COS 消失）时给出原因，
        // 而不是静默返回空列表。
        try {
            ChunkPreview preview = readChunks(doc);
            vo.setChunks(preview.chunks());
            vo.setChunksReadable(true);
            vo.setChunksTruncated(preview.truncated());
            if ("text".equals(vo.getPreviewKind())) {
                vo.setTextPreview(truncate(preview.rawText(), MAX_TEXT_PREVIEW));
            }
        } catch (Exception e) {
            vo.setChunksReadable(false);
            vo.setChunksMessage("无法读取该文档的切片：" + e.getMessage());
            log.warn("读取知识文档切片失败: docId={}", doc.getId(), e);
        }
        return vo;
    }

    @Override
    public KnowledgeDocument getDocumentForRead(Long documentId, User actor) {
        KnowledgeDocument doc = loadDocument(documentId);
        assertCanManage(doc, actor);
        ThrowUtils.throwIf(StrUtil.isBlank(doc.getFileUrl()), ErrorCode.NOT_FOUND_ERROR, "文档没有存储对象");
        return doc;
    }

    @Override
    public void updateDocument(Long documentId, MultipartFile file, String title, Long userId) {
        KnowledgeDocument doc = loadDocument(documentId);
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

    /* ── 内部工具 ─────────────────────────────────────────── */

    /** 取文档并排除已删除行；不存在时抛业务错误。 */
    private KnowledgeDocument loadDocument(Long documentId) {
        ThrowUtils.throwIf(documentId == null || documentId <= 0, ErrorCode.PARAMS_ERROR);
        KnowledgeDocument doc = baseMapper.selectById(documentId);
        ThrowUtils.throwIf(doc == null, ErrorCode.NOT_FOUND_ERROR);
        ThrowUtils.throwIf(doc.getIsDelete() != null && doc.getIsDelete() == 1,
                ErrorCode.NOT_FOUND_ERROR, "文档已被删除");
        return doc;
    }

    /** 只有 owner 与管理员能改这份文档。 */
    private void assertCanManage(KnowledgeDocument doc, User actor) {
        ThrowUtils.throwIf(actor == null, ErrorCode.NO_AUTH_ERROR);
        boolean admin = AuthConstant.ADMIN_ROLE.equals(actor.getUserRole());
        ThrowUtils.throwIf(!admin && !actor.getId().equals(doc.getUserId()),
                ErrorCode.NO_AUTH_ERROR, "只能操作自己的文档");
    }

    /** 删除文档本体：向量 + 对象存储 + 数据库行。 */
    private void purgeDocument(KnowledgeDocument doc) {
        if (doc.getChunkCount() != null && doc.getChunkCount() > 0) {
            try {
                var vectorStore = documentProcessingService.getVectorStore();
                if (vectorStore != null) {
                    vectorStore.delete(buildChunkIds(doc.getId(), doc.getChunkCount()));
                }
            } catch (Exception e) {
                log.warn("向量删除失败，继续删除数据库记录: docId={}", doc.getId(), e);
            }
        }

        try {
            cosManager.deleteObject(doc.getFileUrl());
        } catch (Exception e) {
            log.warn("COS delete failed, will retry via compensation: docId={}", doc.getId(), e);
        }

        baseMapper.deleteById(doc.getId());
    }

    /** id 列表去重 + 去空。 */
    private List<Long> normalizeIds(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        Set<Long> unique = new LinkedHashSet<>();
        for (Long id : ids) {
            if (id != null && id > 0) {
                unique.add(id);
            }
        }
        return new ArrayList<>(unique);
    }

    /**
     * 预览方式：PDF 走浏览器内嵌，纯文本走直读，其余（doc / docx）只能下载。
     */
    private String previewKind(String fileType) {
        if (fileType == null) {
            return "none";
        }
        return switch (fileType.toLowerCase()) {
            case "pdf" -> "pdf";
            case "txt", "md", "markdown" -> "text";
            default -> "none";
        };
    }

    /**
     * 按入库时的同一套规则重放解析与切分，得到这份文档的切片清单。
     *
     * <p>拼接方式与 {@link DocumentProcessingService} 保持逐字一致：
     * 段落以空行相接、首尾去空白，切片编号沿用入库时的
     * {@code doc_{id}_chunk_{i}} 约定——管理员看到的第 3 块就是第 3 块。
     *
     * <p>这里只重放「规则」，不推断向量库里的存量：入库条数只有库里那一个
     * 计数（{@code chunkCount}），向量库实际存了多少条没有接口可查，界面就不说。
     */
    private ChunkPreview readChunks(KnowledgeDocument doc) {
        File temp = null;
        try {
            temp = File.createTempFile("knowledge_preview_", "." + doc.getFileType());
            cosManager.downloadToFile(doc.getFileUrl(), temp);
            List<String> paragraphs = documentParser.parse(temp.getAbsolutePath(), doc.getFileType());
            String rawText = paragraphs.stream().reduce("", (a, b) -> a + "\n\n" + b).trim();
            ThrowUtils.throwIf(StrUtil.isEmpty(rawText), ErrorCode.PARAMS_ERROR,
                    "文档正文为空：解析器没有提取到任何文字");
            Map<String, Object> metadata = documentParser.buildMetadata(
                    rawText, doc.getFileUrl(), doc.getTitle(), doc.getFileType());
            List<Document> chunks = textChunkerService.chunk(rawText, metadata);
            List<KnowledgeChunkVO> list = new ArrayList<>();
            int index = 0;
            boolean truncated = false;
            for (Document chunk : chunks) {
                if (index >= MAX_PREVIEW_CHUNKS) {
                    truncated = true;
                    break;
                }
                list.add(new KnowledgeChunkVO(index, chunk.getText()));
                index++;
            }
            return new ChunkPreview(list, rawText, truncated);
        } catch (IOException e) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "文件读取失败");
        } finally {
            if (temp != null && temp.exists() && !temp.delete()) {
                temp.deleteOnExit();
            }
        }
    }

    private String truncate(String text, int limit) {
        if (text == null) {
            return null;
        }
        return text.length() > limit ? text.substring(0, limit) + "…" : text;
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

    /** 切片清单 + 原文（纯文本直读用）。 */
    private record ChunkPreview(List<KnowledgeChunkVO> chunks, String rawText, boolean truncated) {
    }

    private record UploadResult(Long docId, String filename, String error) {
    }
}
