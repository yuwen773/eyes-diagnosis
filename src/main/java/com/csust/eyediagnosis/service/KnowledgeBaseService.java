package com.csust.eyediagnosis.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.IService;
import com.csust.eyediagnosis.common.BatchResultVO;
import com.csust.eyediagnosis.model.dto.knowledge.KnowledgeQueryDTO;
import com.csust.eyediagnosis.model.dto.knowledge.KnowledgeUploadRequest;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.knowledge.KnowledgeDetailVO;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

public interface KnowledgeBaseService extends IService<KnowledgeDocument> {
    List<Long> uploadDocument(KnowledgeUploadRequest request, Long userId);

    /**
     * 删除单份文档。owner 或管理员可删。
     */
    void deleteDocument(Long documentId, User actor);

    /**
     * 批量删除文档。逐条鉴权与执行，成功/失败如实回执。
     */
    BatchResultVO deleteDocuments(List<Long> documentIds, User actor);

    /**
     * 只改标题（人读的名字），不触碰文件本体与既有切片。
     */
    void updateTitle(Long documentId, String title, User actor);

    /**
     * 文档详情：元信息 + 限时预览链接 + 切片清单。
     */
    KnowledgeDetailVO getDocumentDetail(Long documentId, User actor);

    /**
     * 读取原文所需的文档元信息（含鉴权）。
     *
     * <p>管理端阅读器要拿到文件本体，但对象存储是私有的、也没有对浏览器开放跨域读。
     * 由后端按同一条 {@code owner / 管理员} 规则鉴权后代理流出，前端不必接触
     * COS 凭据，也不会拿到长期有效的直链。
     */
    KnowledgeDocument getDocumentForRead(Long documentId, User actor);

    /**
     * 按筛选条件分页查文档。管理员看全站，普通用户只看本人。
     */
    Page<KnowledgeDocument> pageDocuments(KnowledgeQueryDTO query, User actor);

    void updateDocument(Long documentId, MultipartFile file, String title, Long userId);
}
