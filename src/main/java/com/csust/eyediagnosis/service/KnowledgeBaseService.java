package com.csust.eyediagnosis.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.csust.eyediagnosis.model.dto.knowledge.KnowledgeUploadRequest;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;

public interface KnowledgeBaseService extends IService<KnowledgeDocument> {
    Long uploadDocument(KnowledgeUploadRequest request, Long userId);
    void deleteDocument(Long documentId, Long userId);
}
