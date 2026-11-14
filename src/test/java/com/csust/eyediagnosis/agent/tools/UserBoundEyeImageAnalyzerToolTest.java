package com.csust.eyediagnosis.agent.tools;

import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.manager.CosManager;
import com.csust.eyediagnosis.mapper.UploadTaskMapper;
import com.csust.eyediagnosis.model.entity.UploadTask;
import com.qcloud.cos.model.COSObject;
import com.qcloud.cos.model.COSObjectInputStream;
import com.qcloud.cos.model.ObjectMetadata;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.ByteArrayInputStream;
import java.net.URI;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 评审 P1-05：图像分析工具只接受服务端登记、归属当前用户的 imageId，拒绝一切 URL。 */
class UserBoundEyeImageAnalyzerToolTest {

    private static final Long USER = 42L;
    private static final String OWN_KEY = "agent-chat/42/abcd-uuid.jpg";

    private EyeImageAnalyzerTool inner;
    private UploadTaskMapper taskMapper;
    private CosManager cosManager;
    private UserBoundEyeImageAnalyzerTool tool;

    @BeforeEach
    void setUp() {
        taskMapper = mock(UploadTaskMapper.class);
        cosManager = mock(CosManager.class);
        inner = new EyeImageAnalyzerTool(cosManager, taskMapper);
        ReflectionTestUtils.setField(inner, "baseUrl", "https://vision.example.invalid");
        ReflectionTestUtils.setField(inner, "apiKey", "test-key");
        ReflectionTestUtils.setField(inner, "model", "test-model");
        tool = new UserBoundEyeImageAnalyzerTool(inner, USER);
    }

    private void registerTask(String objectKey, int status) {
        UploadTask task = new UploadTask();
        task.setTaskId("task-1");
        task.setUserId(USER);
        task.setObjectKey(objectKey);
        task.setStatus(status);
        when(taskMapper.selectByObjectKey(USER, objectKey)).thenReturn(task);
    }

    private COSObject cosObject(byte[] bytes) {
        COSObject object = new COSObject();
        ObjectMetadata metadata = new ObjectMetadata();
        metadata.setContentLength(bytes.length);
        object.setObjectMetadata(metadata);
        object.setObjectContent(new COSObjectInputStream(new ByteArrayInputStream(bytes),
                new org.apache.http.client.methods.HttpGet("http://localhost/test")));
        return object;
    }

    @Test
    void rejectsExternalUrlsBeforeAnyCosOrModelAccess() {
        for (String hostile : new String[]{
                "https://attacker.example.com/fundus.jpg",
                "http://169.254.169.254/latest/meta-data",
                "file:///etc/passwd",
                "https://host/agent-chat/42/x.jpg?sig=1",
                "agent-chat/41/other-user.jpg",
                "agent-chat/42/../secret.jpg",
                ""}) {
            BusinessException fault = assertThrows(BusinessException.class, () -> tool.analyzeEyeImage(hostile));
            assertTrue(fault.getCode() == 40000 || fault.getCode() == 40101,
                    "URL/越权 imageId 必须被参数或权限错误拒绝: " + hostile);
        }
        verify(cosManager, never()).getObject(any());
        verify(taskMapper, never()).selectByObjectKey(any(), any());
    }

    @Test
    void neverFollowsSchemeLikePayloadsEvenWhenWrapped() {
        // 模型可能把 URI 包在合法前缀里；含 : 的输入必须直接拒绝
        BusinessException fault = assertThrows(BusinessException.class,
                () -> tool.analyzeEyeImage("agent-chat/42/http:evil"));
        assertEquals(40000, fault.getCode());
        verify(cosManager, never()).getObject(any());
    }

    @Test
    void deletedUploadTaskStopsAnalysis() {
        registerTask(OWN_KEY, 5 /* DELETED */);
        BusinessException fault = assertThrows(BusinessException.class, () -> tool.analyzeEyeImage(OWN_KEY));
        assertEquals(40000, fault.getCode());
        verify(cosManager, never()).getObject(any());
    }

    @Test
    void missingUploadTaskStopsAnalysis() {
        when(taskMapper.selectByObjectKey(USER, OWN_KEY)).thenReturn(null);
        BusinessException fault = assertThrows(BusinessException.class, () -> tool.analyzeEyeImage(OWN_KEY));
        assertEquals(40000, fault.getCode());
        verify(cosManager, never()).getObject(any());
    }

    @Test
    void ownedActiveImageIsReadFromConfiguredStorageNotFromUrl() throws Exception {
        registerTask(OWN_KEY, 2 /* PERSISTED */);
        // vision client 未初始化（无外部依赖），说明读取只发生在 COS 校验之后
        when(cosManager.getObject(eq(OWN_KEY))).thenReturn(cosObject(new byte[]{1, 2, 3}));

        // 这里只验证所有权与存储读取路径：直接调 analyzeOwnedImage 会因 vision client
        // 为 null 落入兜底结果（模型调用失败路径），但 COS 必须已被读取。
        var result = inner.analyzeOwnedImage(OWN_KEY, USER);
        assertEquals("图像分析失败", result.getDescription());
        verify(cosManager).getObject(eq(OWN_KEY));
    }

    @Test
    void oversizedObjectIsRejectedWithoutModelCall() {
        registerTask(OWN_KEY, 4 /* COMPLETED */);
        when(cosManager.getObject(eq(OWN_KEY))).thenReturn(cosObject(new byte[2 * 1024 * 1024 + 1]));

        // 超限对象必须以参数错误终止，绝不进入模型调用；COS 是唯一读取来源
        BusinessException fault = assertThrows(BusinessException.class, () -> inner.analyzeOwnedImage(OWN_KEY, USER));
        assertEquals(40000, fault.getCode());
        verify(cosManager).getObject(eq(OWN_KEY));
        verify(cosManager, Mockito.never()).getObject(Mockito.startsWith("http"));
    }

    @Test
    void toolRefusesUnboundEntrypoint() {
        // 未经 UserBound 包装的直连入口必须拒绝，防止绕过用户绑定
        BusinessException fault = assertThrows(BusinessException.class, () -> inner.analyzeEyeImage(OWN_KEY));
        assertEquals(40101, fault.getCode());
        verify(cosManager, never()).getObject(any());
    }
}
