package com.csust.eyediagnosis.agent.tools;

import com.csust.eyediagnosis.agent.InvalidToolOutputException;
import com.csust.eyediagnosis.agent.model.EyeAnalysisResult;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.manager.CosManager;
import com.csust.eyediagnosis.mapper.UploadTaskMapper;
import com.csust.eyediagnosis.model.entity.UploadTask;
import com.qcloud.cos.model.COSObject;
import com.qcloud.cos.model.COSObjectInputStream;
import com.qcloud.cos.model.ObjectMetadata;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.test.util.ReflectionTestUtils;
import reactor.core.publisher.Flux;

import java.io.ByteArrayInputStream;
import java.util.List;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * P0-01：上游视觉模型返回的**结构**决定这次调用是成功还是失败。
 *
 * <p>旧实现有两个假成功入口：`{}` 变成全空 DTO；解析异常变成一条带
 * `urgency="attention"` 的兜底结果。两者都被记成 succeeded。这里逐条钉住
 * 「什么算有效分析结果」，并保留合法响应的成功对照，防止把校验写成一律失败。
 */
class EyeImageAnalyzerToolOutputValidationTest {

    private static final long USER = 42L;
    private static final String OWN_KEY = "agent-chat/42/fundus.jpg";

    private EyeImageAnalyzerTool tool;
    private UploadTaskMapper taskMapper;
    private CosManager cosManager;

    @BeforeEach
    void setUp() {
        taskMapper = mock(UploadTaskMapper.class);
        cosManager = mock(CosManager.class);
        tool = new EyeImageAnalyzerTool(cosManager, taskMapper);
        UploadTask task = new UploadTask();
        task.setTaskId("task-1");
        task.setUserId(USER);
        task.setObjectKey(OWN_KEY);
        task.setStatus(2 /* PERSISTED，活跃 */);
        when(taskMapper.selectByObjectKey(USER, OWN_KEY)).thenReturn(task);
        when(cosManager.getObject(eq(OWN_KEY))).thenReturn(cosObject());
    }

    private static COSObject cosObject() {
        byte[] bytes = {1, 2, 3};
        COSObject object = new COSObject();
        ObjectMetadata metadata = new ObjectMetadata();
        metadata.setContentLength(bytes.length);
        object.setObjectMetadata(metadata);
        object.setObjectContent(new COSObjectInputStream(new ByteArrayInputStream(bytes),
                new org.apache.http.client.methods.HttpGet("http://localhost/test")));
        return object;
    }

    /** 让视觉模型返回固定文本（或抛异常），其余依赖都是真的。 */
    private void visionReturns(Supplier<String> upstream) {
        ChatModel model = new ChatModel() {
            @Override
            public ChatResponse call(Prompt prompt) {
                return new ChatResponse(List.of(new Generation(new AssistantMessage(upstream.get()))));
            }

            @Override
            public Flux<ChatResponse> stream(Prompt prompt) {
                return Flux.just(call(prompt));
            }
        };
        ReflectionTestUtils.setField(tool, "visionChatClient", ChatClient.builder(model).build());
    }

    private static final String VALID = """
            {"description":"眼底照片，视盘边界清晰","imageType":"眼底照片",
             "keyFeatures":["视盘边界清晰","黄斑区反光正常"],
             "abnormalities":["未发现明显异常"],
             "medicalKeywords":"fundus, retina, optic disc",
             "urgency":"normal",
             "recommendations":"定期复查"}
            """;

    @Test
    void validStructuredResponseIsAccepted() {
        visionReturns(() -> VALID);
        EyeAnalysisResult result = tool.analyzeOwnedImage(OWN_KEY, USER);
        assertEquals("眼底照片，视盘边界清晰", result.getDescription());
        assertEquals("normal", result.getUrgency());
        assertEquals(List.of("视盘边界清晰", "黄斑区反光正常"), result.getKeyFeatures());
        assertEquals(List.of("未发现明显异常"), result.getAbnormalities());
    }

    @Test
    void markdownFencedValidResponseIsAccepted() {
        visionReturns(() -> "```json\n" + VALID + "\n```");
        assertEquals("normal", tool.analyzeOwnedImage(OWN_KEY, USER).getUrgency());
    }

    @Test
    void emptyObjectIsInvalidOutputNotAnEmptyShell() {
        visionReturns(() -> "{}");
        assertInvalid();
    }

    @Test
    void emptyArrayIsInvalidOutput() {
        visionReturns(() -> "[]");
        assertInvalid();
    }

    @Test
    void missingRequiredFieldIsInvalidOutput() {
        visionReturns(() -> VALID.replace("\"urgency\":\"normal\",", ""));
        assertInvalid();
    }

    @Test
    void illegalUrgencyIsInvalidOutput() {
        visionReturns(() -> VALID.replace("\"urgency\":\"normal\"", "\"urgency\":\"high\""));
        assertInvalid();
    }

    @Test
    void wrongFieldTypeIsInvalidOutput() {
        // keyFeatures 应该是数组；模型给了字符串
        visionReturns(() -> VALID.replace("[\"视盘边界清晰\",\"黄斑区反光正常\"]", "\"视盘边界清晰\""));
        assertInvalid();
    }

    @Test
    void notJsonIsInvalidOutput() {
        visionReturns(() -> "抱歉，我无法分析这张图片。");
        assertInvalid();
    }

    @Test
    void markdownWrappedGarbageIsInvalidOutput() {
        visionReturns(() -> "```json\n{不是 JSON}\n```");
        assertInvalid();
    }

    @Test
    void proseFollowedByJsonIsNotSilentlyAccepted() {
        // 尾随内容必须让解析失败：把「解释 + 一小段 JSON」当成结构化结果会漏掉解释里的结论。
        visionReturns(() -> "分析如下：" + VALID);
        assertInvalid();
    }

    @Test
    void blankResponseIsInvalidOutput() {
        visionReturns(() -> "   ");
        assertInvalid();
    }

    @Test
    void nullResponseIsInvalidOutput() {
        visionReturns(() -> null);
        assertInvalid();
    }

    @Test
    void upstreamFailureIsServiceErrorNotFakeAnalysis() {
        visionReturns(() -> {
            throw new IllegalStateException("vision provider down");
        });
        BusinessException fault = assertThrows(BusinessException.class,
                () -> tool.analyzeOwnedImage(OWN_KEY, USER));
        assertEquals(50000, fault.getCode());
    }

    private void assertInvalid() {
        InvalidToolOutputException fault = assertThrows(InvalidToolOutputException.class,
                () -> tool.analyzeOwnedImage(OWN_KEY, USER));
        // 错误文本面向用户，绝不回显上游原文
        assertEquals(false, fault.getMessage().contains("视盘"));
    }
}
