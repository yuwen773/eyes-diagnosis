package com.csust.eyediagnosis.manager;

import com.csust.eyediagnosis.config.CosClientConfig;
import com.csust.eyediagnosis.constant.FileConstant;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.model.dto.file.UploadPictureDetail;
import com.qcloud.cos.model.PutObjectResult;
import com.qcloud.cos.model.ciModel.persistence.CIUploadResult;
import com.qcloud.cos.model.ciModel.persistence.ImageInfo;
import com.qcloud.cos.model.ciModel.persistence.OriginalInfo;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;

import java.io.File;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 上传校验与对象存储失败语义。
 *
 * <p>全部使用 Mock 的 COS 客户端，不访问真实对象存储。
 */
@ExtendWith(MockitoExtension.class)
class FileManagerTest {

    @Mock
    private CosClientConfig cosClientConfig;
    @Mock
    private CosManager cosManager;
    @InjectMocks
    private FileManager fileManager;

    @Test
    void acceptsLegalPngAndReturnsKeyAndUrl() {
        when(cosClientConfig.getHost()).thenReturn("https://cdn.example");
        when(cosManager.putPictureObject(anyString(), any(File.class))).thenReturn(pictureResult());

        UploadPictureDetail detail = fileManager.uploadPicture(bytes("eye.png", 1024), "public/7");

        // 既有拼接格式：host + "/" + 以 "/" 开头的 key（会出现双斜杠，保持不变以免影响已有记录）。
        assertEquals("https://cdn.example/" + detail.getObjectKey(), detail.getUrl());
        assertTrue(detail.getObjectKey().startsWith("/public/7/"), "上传前缀必须按用户隔离");
        assertEquals(640, detail.getPicWidth());
        assertEquals(480, detail.getPicHeight());
        assertEquals("png", detail.getPicFormat());
    }

    @Test
    void rejectsOversizedFileBeforeTouchingObjectStorage() {
        MockMultipartFile file = bytes("big.png", 2 * 1024 * 1024 + 1);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> fileManager.uploadPicture(file, "public/7"));

        assertEquals(ErrorCode.PARAMS_ERROR.getCode(), ex.getCode());
        assertEquals(FileConstant.FILE_SIZE_ERROR, ex.getMessage());
        verify(cosManager, never()).putPictureObject(anyString(), any(File.class));
    }

    @Test
    void exactlyTwoMegabytesIsAccepted() {
        when(cosClientConfig.getHost()).thenReturn("https://cdn.example");
        when(cosManager.putPictureObject(anyString(), any(File.class))).thenReturn(pictureResult());

        assertDoesNotThrow(() -> fileManager.uploadPicture(bytes("edge.png", 2 * 1024 * 1024), "public/7"));
    }

    @Test
    void rejectsUnsupportedType() {
        BusinessException ex = assertThrows(BusinessException.class,
                () -> fileManager.uploadPicture(bytes("anim.gif", 1024), "public/7"));

        assertEquals(ErrorCode.PARAMS_ERROR.getCode(), ex.getCode());
        assertEquals(FileConstant.FILE_TYPE_ERROR, ex.getMessage());
    }

    @Test
    void rejectsNullFile() {
        BusinessException ex = assertThrows(BusinessException.class,
                () -> fileManager.uploadPicture(null, "public/7"));

        assertEquals(ErrorCode.PARAMS_ERROR.getCode(), ex.getCode());
    }

    @Test
    void rejectsEmptyFileBeforeTouchingObjectStorage() {
        // 0 字节不是合法图片：直接拒掉，别让对象存储收下一份空对象。
        MockMultipartFile file = bytes("empty.png", 0);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> fileManager.uploadPicture(file, "public/7"));

        assertEquals(ErrorCode.PARAMS_ERROR.getCode(), ex.getCode());
        assertEquals(FileConstant.FILE_CONTENT_EMPTY, ex.getMessage());
        verify(cosManager, never()).putPictureObject(anyString(), any(File.class));
    }

    @Test
    void objectStorageTimeoutSurfacesAsStorageFailure() {
        // 超时 / 鉴权失败 / 服务端异常在 COS 客户端都是运行时异常，这里统一验证
        // 它们被转成 SYSTEM_ERROR，而不是被当成「上传成功但没有地址」。
        when(cosManager.putPictureObject(anyString(), any(File.class)))
                .thenThrow(new RuntimeException("SocketTimeoutException: read timed out"));

        BusinessException ex = assertThrows(BusinessException.class,
                () -> fileManager.uploadPicture(bytes("eye.png", 1024), "public/7"));

        assertEquals(ErrorCode.SYSTEM_ERROR.getCode(), ex.getCode());
        assertEquals(FileConstant.FAIL_UPLOAD, ex.getMessage());
    }

    @Test
    void compensationDeleteSwallowsStorageErrors() {
        org.mockito.Mockito.doThrow(new RuntimeException("cos down"))
                .when(cosManager).deleteObject("public/7/x.png");

        assertDoesNotThrow(() -> fileManager.deleteUploadedPictureQuietly("public/7/x.png"));
    }

    @Test
    void compensationDeleteIgnoresBlankKey() {
        assertDoesNotThrow(() -> fileManager.deleteUploadedPictureQuietly(null));
        assertDoesNotThrow(() -> fileManager.deleteUploadedPictureQuietly("  "));
        verify(cosManager, never()).deleteObject(anyString());
    }

    // --- helpers -----------------------------------------------------------

    private static MockMultipartFile bytes(String name, int size) {
        return new MockMultipartFile("file", name, "image/png", new byte[size]);
    }

    private static PutObjectResult pictureResult() {
        ImageInfo info = new ImageInfo();
        info.setWidth(640);
        info.setHeight(480);
        info.setFormat("png");
        OriginalInfo original = new OriginalInfo();
        original.setImageInfo(info);
        CIUploadResult ci = new CIUploadResult();
        ci.setOriginalInfo(original);
        PutObjectResult result = new PutObjectResult();
        result.setCiUploadResult(ci);
        return result;
    }
}
