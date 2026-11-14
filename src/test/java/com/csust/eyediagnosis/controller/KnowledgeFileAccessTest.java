package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.manager.CosManager;
import com.csust.eyediagnosis.mapper.KnowledgeDocumentMapper;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.knowledge.KnowledgeDetailVO;
import com.csust.eyediagnosis.service.KnowledgeBaseService;
import com.csust.eyediagnosis.service.UserService;
import com.csust.eyediagnosis.service.impl.KnowledgeBaseServiceImpl;
import com.qcloud.cos.model.COSObject;
import com.qcloud.cos.model.ObjectMetadata;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 管理端原文读取端点的契约。
 *
 * <p>阅读器不再拿 COS 签名直链（会过期、且桶没对浏览器开放跨域读），改走后端
 * 代理：鉴权规则必须与 {@code /knowledge/get/{id}} 完全一致（owner 或管理员），
 * MIME 必须按真实扩展名给出，文件名必须按 RFC 5987 编码，响应必须是流式的。
 */
class KnowledgeFileAccessTest {

    private static KnowledgeDocument doc(Long id, String fileName, String fileType) {
        KnowledgeDocument doc = new KnowledgeDocument();
        doc.setId(id);
        doc.setUserId(100L);
        doc.setFileName(fileName);
        doc.setFileType(fileType);
        doc.setFileUrl("object-key");
        doc.setIsDelete(0);
        return doc;
    }

    private static User user(String role, Long id) {
        User user = new User();
        user.setId(id);
        user.setUserRole(role);
        return user;
    }

    // ── 服务层：鉴权 ─────────────────────────────────────────

    @Test
    void ownerCanReadOwnDocument() {
        KnowledgeDocumentMapper mapper = mock(KnowledgeDocumentMapper.class);
        KnowledgeDocumentServiceImplHolder holder = new KnowledgeDocumentServiceImplHolder(mapper);

        assertEquals("owner.md", holder.service.getDocumentForRead(7L, user("user", 100L)).getFileName());
    }

    @Test
    void adminCanReadAnyDocument() {
        KnowledgeDocumentMapper mapper = mock(KnowledgeDocumentMapper.class);
        KnowledgeDocumentServiceImplHolder holder = new KnowledgeDocumentServiceImplHolder(mapper);

        assertEquals("owner.md", holder.service.getDocumentForRead(7L, user("admin", 999L)).getFileName());
    }

    @Test
    void strangerCannotReadOtherUsersDocument() {
        KnowledgeDocumentMapper mapper = mock(KnowledgeDocumentMapper.class);
        KnowledgeDocumentServiceImplHolder holder = new KnowledgeDocumentServiceImplHolder(mapper);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> holder.service.getDocumentForRead(7L, user("user", 200L)));
        assertEquals(ErrorCode.NO_AUTH_ERROR.getCode(), ex.getCode());
    }

    @Test
    void anonymousCannotRead() {
        KnowledgeDocumentMapper mapper = mock(KnowledgeDocumentMapper.class);
        KnowledgeDocumentServiceImplHolder holder = new KnowledgeDocumentServiceImplHolder(mapper);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> holder.service.getDocumentForRead(7L, null));
        assertEquals(ErrorCode.NO_AUTH_ERROR.getCode(), ex.getCode());
    }

    @Test
    void missingDocumentIsNotFound() {
        KnowledgeDocumentMapper mapper = mock(KnowledgeDocumentMapper.class);
        when(mapper.selectById(7L)).thenReturn(null);
        KnowledgeBaseServiceImpl service = new KnowledgeBaseServiceImpl();
        ReflectionTestUtils.setField(service, "baseMapper", mapper);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.getDocumentForRead(7L, user("admin", 999L)));
        assertEquals(ErrorCode.NOT_FOUND_ERROR.getCode(), ex.getCode());
    }

    /** 把 baseMapper 注入真实实现——单测只钉鉴权分支，不碰数据库。 */
    private static class KnowledgeDocumentServiceImplHolder {
        final KnowledgeBaseServiceImpl service = new KnowledgeBaseServiceImpl();

        KnowledgeDocumentServiceImplHolder(KnowledgeDocumentMapper mapper) {
            when(mapper.selectById(7L)).thenReturn(doc(7L, "owner.md", "md"));
            ReflectionTestUtils.setField(service, "baseMapper", mapper);
        }
    }

    // ── 控制器：流式响应与响应头 ──────────────────────────────

    private static KnowledgeBaseController controller(KnowledgeBaseService service, CosManager cos) {
        KnowledgeBaseController controller = new KnowledgeBaseController();
        ReflectionTestUtils.setField(controller, "knowledgeBaseService", service);
        ReflectionTestUtils.setField(controller, "userService", mock(UserService.class));
        ReflectionTestUtils.setField(controller, "cosManager", cos);
        return controller;
    }

    private static COSObject objectWith(String body) {
        COSObject object = new COSObject();
        ObjectMetadata metadata = new ObjectMetadata();
        metadata.setContentLength(body.getBytes(StandardCharsets.UTF_8).length);
        object.setObjectMetadata(metadata);
        object.setObjectContent(new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
        return object;
    }

    @Test
    void streamsDocumentWithMappedMimeAndEncodedFileName() throws Exception {
        KnowledgeBaseService service = mock(KnowledgeBaseService.class);
        CosManager cos = mock(CosManager.class);
        when(service.getDocumentForRead(eq(7L), any())).thenReturn(doc(7L, "眼科 记录.md", "md"));
        when(cos.getObject("object-key")).thenReturn(objectWith("hello"));

        ResponseEntity<StreamingResponseBody> response =
                controller(service, cos).getContent(7L, true, null);

        assertEquals(MediaType.parseMediaType("text/markdown;charset=UTF-8"),
                response.getHeaders().getContentType());
        assertEquals(5, response.getHeaders().getContentLength());
        assertTrue(response.getHeaders().getContentDisposition().isAttachment());
        assertEquals("nosniff", response.getHeaders().getFirst("X-Content-Type-Options"));
        // RFC 5987：中文文件名以 UTF-8 百分号编码落到 filename*。
        assertTrue(response.getHeaders().getContentDisposition().toString()
                .contains("filename*=UTF-8''"));

        // 流本身由容器写出；单测只钉响应头（COSObjectInputStream.close 需要
        // 真实 HTTP 连接，mock 出来的对象关闭会 NPE，不在这里假装跑完整链路）。
        assertNotNull(response.getBody());
    }

    @Test
    void inlineByDefaultSoPdfRendersInFrame() {
        // 内嵌阅读器直接把这个地址塞进 iframe：默认必须是 inline，
        // attachment 会让浏览器下载、iframe 空白。
        KnowledgeBaseService service = mock(KnowledgeBaseService.class);
        CosManager cos = mock(CosManager.class);
        when(service.getDocumentForRead(eq(7L), any())).thenReturn(doc(7L, "眼底.pdf", "pdf"));
        when(cos.getObject("object-key")).thenReturn(objectWith("%PDF-1.4"));

        ResponseEntity<StreamingResponseBody> response =
                controller(service, cos).getContent(7L, false, null);

        assertTrue(response.getHeaders().getContentDisposition().isInline());
        assertEquals(MediaType.APPLICATION_PDF, response.getHeaders().getContentType());
    }

    @Test
    void contentTypeFollowsExtension() {
        KnowledgeBaseController controller = controller(
                mock(KnowledgeBaseService.class), mock(CosManager.class));

        assertEquals("application/pdf", ReflectionTestUtils.invokeMethod(controller, "contentTypeOf", "pdf"));
        assertEquals("application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ReflectionTestUtils.invokeMethod(controller, "contentTypeOf", "docx"));
        assertEquals("application/msword", ReflectionTestUtils.invokeMethod(controller, "contentTypeOf", "doc"));
        assertEquals("text/plain;charset=UTF-8",
                ReflectionTestUtils.invokeMethod(controller, "contentTypeOf", "txt"));
        // 未知扩展名按二进制附件下发，不让浏览器猜成可渲染类型。
        assertEquals("application/octet-stream",
                ReflectionTestUtils.invokeMethod(controller, "contentTypeOf", "exe"));
    }

    @Test
    void unauthorizedReadPropagatesBeforeTouchingStorage() {
        KnowledgeBaseService service = mock(KnowledgeBaseService.class);
        CosManager cos = mock(CosManager.class);
        when(service.getDocumentForRead(eq(7L), any()))
                .thenThrow(new BusinessException(ErrorCode.NO_AUTH_ERROR, "只能操作自己的文档"));

        BusinessException ex = assertThrows(BusinessException.class,
                () -> controller(service, cos).getContent(7L, false, null));
        assertEquals(ErrorCode.NO_AUTH_ERROR.getCode(), ex.getCode());
    }

    @Test
    void detailContractStillReturnsPreviewFields() {
        // 详情端点保留原有字段：前端阅读器仍用它拿切片与元信息。
        KnowledgeBaseService service = mock(KnowledgeBaseService.class);
        KnowledgeDetailVO vo = new KnowledgeDetailVO();
        vo.setPreviewKind("pdf");
        vo.setChunksReadable(true);
        when(service.getDocumentDetail(eq(7L), any())).thenReturn(vo);

        BaseResponse<KnowledgeDetailVO> response =
                controller(service, mock(CosManager.class)).getDetail(7L, null);
        assertEquals(0, response.getCode());
        assertEquals("pdf", response.getData().getPreviewKind());
        assertTrue(response.getData().isChunksReadable());
    }
}
