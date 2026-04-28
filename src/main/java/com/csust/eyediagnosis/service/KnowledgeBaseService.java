package com.csust.eyediagnosis.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.csust.eyediagnosis.model.dto.knowledge.KnowledgeUploadRequest;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

public interface KnowledgeBaseService extends IService<KnowledgeDocument> {
    List<Long> uploadDocument(KnowledgeUploadRequest request, Long userId);
    void deleteDocument(Long documentId, Long userId);
    void updateDocument(Long documentId, MultipartFile file, String title, Long userId);
}
