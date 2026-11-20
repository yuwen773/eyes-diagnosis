package com.csust.eyediagnosis.agent.service;

import com.csust.eyediagnosis.config.CosClientConfig;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.manager.CosManager;
import com.csust.eyediagnosis.mapper.UploadTaskMapper;
import com.csust.eyediagnosis.model.entity.UploadTask;
import com.csust.eyediagnosis.upload.state.UploadCompensationService;
import com.csust.eyediagnosis.upload.state.UploadStateMachine;
import com.csust.eyediagnosis.upload.state.UploadStatus;
import com.qcloud.cos.model.CannedAccessControlList;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AgentImageUploadServiceTest {

    @Mock
    private CosManager cosManager;
    @Mock
    private CosClientConfig cosClientConfig;
    @Mock
    private UploadCompensationService uploadCompensationService;
    @Mock
    private UploadStateMachine uploadStateMachine;
    @Mock
    private UploadTaskMapper uploadTaskMapper;
    @InjectMocks
    private AgentImageUploadService service;

    @Test
    void rejectsExecutableRenamedAsPng() {
        MockMultipartFile file = new MockMultipartFile(
                "file", "fake.png", "image/png", "not-an-image".getBytes());
        assertThrows(BusinessException.class, () -> service.uploadImage(file, 7L));
        verifyNoInteractions(cosManager);
    }

    @Test
    void deletionRejectsForeignObjectKey() {
        assertThrows(BusinessException.class,
                () -> service.deleteImage("https://cos-host/agent-chat/8/a.png", 7L));
        verifyNoInteractions(cosManager);
    }

    @Test
    void deleteCallsCosManagerWithOwnedObjectKey() {
        when(cosClientConfig.getHost()).thenReturn("https://cos-host");
        when(cosManager.objectExists(anyString())).thenReturn(true);

        service.deleteImage("https://cos-host/agent-chat/7/uuid.png", 7L);

        verify(cosManager).objectExists("agent-chat/7/uuid.png");
        verify(cosManager).deleteObject("agent-chat/7/uuid.png");
    }

    @Test
    void deleteRegistersDeletionIntentBeforeTouchingCos() {
        when(cosClientConfig.getHost()).thenReturn("https://cos-host");
        when(cosManager.objectExists(anyString())).thenReturn(true);

        service.deleteImage("https://cos-host/agent-chat/7/uuid.png", 7L);

        verify(uploadCompensationService).markDeleted("agent-chat/7/uuid.png", 7L);
    }

    @Test
    void deleteSkipsCallWhenObjectMissing() {
        when(cosClientConfig.getHost()).thenReturn("https://cos-host");
        when(cosManager.objectExists(anyString())).thenReturn(false);

        service.deleteImage("https://cos-host/agent-chat/7/uuid.png", 7L);

        verify(cosManager).objectExists("agent-chat/7/uuid.png");
        verify(cosManager, never()).deleteObject(anyString());
    }

    private static byte[] onePixelPng() throws Exception {
        BufferedImage image = new BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        return out.toByteArray();
    }

    private UploadTask ownedTask(long userId, String objectKey, UploadStatus status) {
        UploadTask task = new UploadTask();
        task.setUserId(userId);
        task.setObjectKey(objectKey);
        task.setStatus(status.getCode());
        return task;
    }

    @Test
    void uploadStoresAgentImageWithPrivateObjectAcl() throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", "eye.png", "image/png", onePixelPng());

        service.uploadImage(file, 7L);

        // 敏感影像必须以对象级私有 ACL 写入，覆盖公有读桶的默认继承，匿名直链不可读。
        verify(cosManager).putObject(anyString(), any(File.class),
                eq(CannedAccessControlList.Private));
    }

    @Test
    void ownedViewReturnsSignedUrlNotPublicHost() {
        when(uploadTaskMapper.selectByObjectKey(7L, "agent-chat/7/a.png"))
                .thenReturn(ownedTask(7L, "agent-chat/7/a.png", UploadStatus.PERSISTED));
        when(cosManager.generatePresignedUrl(eq("agent-chat/7/a.png"), any()))
                .thenReturn("https://signed.invalid/agent-chat/7/a.png?sign=x");

        String target = service.resolveViewTarget("a.png", 7L);

        assertEquals("https://signed.invalid/agent-chat/7/a.png?sign=x", target);
        assertTrue(target.contains("sign="), "视图目标必须是签名 URL，而非裸公有 host 地址");
    }

    @Test
    void signedViewUrlExpiresWithinShortWindow() {
        when(uploadTaskMapper.selectByObjectKey(7L, "agent-chat/7/a.png"))
                .thenReturn(ownedTask(7L, "agent-chat/7/a.png", UploadStatus.PERSISTED));
        when(cosManager.generatePresignedUrl(anyString(), any())).thenReturn("https://signed.invalid/x");
        long before = System.currentTimeMillis();

        service.resolveViewTarget("a.png", 7L);

        ArgumentCaptor<Date> expiry = ArgumentCaptor.forClass(Date.class);
        verify(cosManager).generatePresignedUrl(eq("agent-chat/7/a.png"), expiry.capture());
        long ttl = expiry.getValue().getTime() - before;
        assertTrue(ttl > 0 && ttl <= 6 * 60 * 1000L, "签名有效期必须是短时正数：" + ttl);
    }

    @Test
    void crossUserAndDeletedViewsAreRejectedBeforeSigning() {
        when(uploadTaskMapper.selectByObjectKey(8L, "agent-chat/8/a.png")).thenReturn(null);
        assertThrows(BusinessException.class, () -> service.resolveViewTarget("a.png", 8L));

        when(uploadTaskMapper.selectByObjectKey(7L, "agent-chat/7/a.png"))
                .thenReturn(ownedTask(7L, "agent-chat/7/a.png", UploadStatus.DELETED));
        assertThrows(BusinessException.class, () -> service.resolveViewTarget("a.png", 7L));

        verify(cosManager, never()).generatePresignedUrl(anyString(), any());
    }
}
