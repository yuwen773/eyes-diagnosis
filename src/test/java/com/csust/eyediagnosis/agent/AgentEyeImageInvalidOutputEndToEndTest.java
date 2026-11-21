package com.csust.eyediagnosis.agent;

import com.csust.eyediagnosis.agent.config.AgentConstants;
import com.csust.eyediagnosis.agent.interceptor.TextMcpModelInterceptor;
import com.csust.eyediagnosis.agent.service.AgentImageUploadService;
import com.csust.eyediagnosis.agent.service.ChatHistoryService;
import com.csust.eyediagnosis.agent.service.ToolAuditService;
import com.csust.eyediagnosis.agent.tools.DocumentSearchTool;
import com.csust.eyediagnosis.agent.tools.EyeImageAnalyzerTool;
import com.csust.eyediagnosis.manager.CosManager;
import com.csust.eyediagnosis.mapper.UploadTaskMapper;
import com.csust.eyediagnosis.model.dto.agent.MessageDTO;
import com.csust.eyediagnosis.model.dto.agent.MessageType;
import com.csust.eyediagnosis.model.entity.UploadTask;
import com.qcloud.cos.model.COSObject;
import com.qcloud.cos.model.COSObjectInputStream;
import com.qcloud.cos.model.ObjectMetadata;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.ToolResponseMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.test.util.ReflectionTestUtils;
import reactor.core.publisher.Flux;

import java.io.ByteArrayInputStream;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * P0-01 端到端：真实 {@code UserBoundEyeImageAnalyzerTool} + 真实 {@code ReactAgent}，
 * 上游视觉模型返回不可用内容。
 *
 * <p>Codex 的复现是「空 JSON / 无法解析的服务提示 → SSE running→succeeded，历史写
 * succeeded，审计 SUCCEEDED/NONE」。这里把同一条链的四个出口都钉住：SSE 帧、
 * 历史落库、审计记录、模型收到的工具响应。只测私有解析函数挡不住框架再次把
 * 失败记成成功。
 */
class AgentEyeImageInvalidOutputEndToEndTest {

    private static final long USER_ID = 42L;
    private static final String IMAGE_KEY = "agent-chat/42/fundus.jpg";

    @Test
    void invalidUpstreamJsonEndsAsFailedEverywhere() {
        ChatHistoryService history = mock(ChatHistoryService.class);
        ToolAuditService audit = mock(ToolAuditService.class);
        when(audit.digestKey()).thenReturn(new byte[]{9, 9, 9});

        ToolCallingModel model = new ToolCallingModel();
        DiagnosisAgent agent = new DiagnosisAgent();
        ReflectionTestUtils.setField(agent, "chatModel", model);
        TextMcpModelInterceptor mcp = mock(TextMcpModelInterceptor.class);
        when(mcp.resolveMcpCallbacks(any(), any())).thenReturn(new ToolCallback[0]);
        ReflectionTestUtils.setField(agent, "textMcpModelInterceptor", mcp);
        ReflectionTestUtils.setField(agent, "chatHistoryService", history);
        ReflectionTestUtils.setField(agent, "agentImageUploadService", mock(AgentImageUploadService.class));
        ReflectionTestUtils.setField(agent, "agentConstants", constants());
        ReflectionTestUtils.setField(agent, "eyeImageAnalyzerTool", analyzerReturning("{}"));
        ReflectionTestUtils.setField(agent, "documentSearchTool", mock(DocumentSearchTool.class));
        ReflectionTestUtils.setField(agent, "toolAuditService", audit);

        List<MessageDTO> events = agent.stream("看看这张眼底照片", null, "thread-p0-1", USER_ID, null, null)
                .collectList()
                .block(Duration.ofSeconds(60));
        assertNotNull(events);

        // 终态帧（TOOL_RESULT 通道也承载 running 状态增量，那不是结果）
        List<MessageDTO> toolResults = events.stream()
                .filter(e -> MessageType.TOOL_RESULT == e.getMessageType())
                .filter(e -> !ToolStepContract.Status.RUNNING.wire().equals(e.getToolStatus()))
                .toList();
        assertEquals(1, toolResults.size(), summarize(events));
        MessageDTO terminal = toolResults.get(0);
        assertEquals(ToolStepContract.Status.FAILED.wire(), terminal.getToolStatus(),
                "空 JSON 的分析必须失败，不能记成成功：" + summarize(events));
        assertEquals(ToolStepContract.ErrorCategory.INVALID_OUTPUT.name(), terminal.getErrorCategory(),
                "无效上游输出必须分类为 INVALID_OUTPUT");
        assertTrue(terminal.getResources() == null || terminal.getResources().isEmpty(),
                "失败调用不得携带任何资源");

        // 历史：失败终态落库，且正文为空（不把上游原文写进库）
        ArgumentCaptor<String> persisted = ArgumentCaptor.forClass(String.class);
        org.mockito.Mockito.verify(history).saveToolResultMessage(eq("thread-p0-1"), eq(USER_ID), persisted.capture(),
                org.mockito.ArgumentMatchers.<Long>isNull(), org.mockito.ArgumentMatchers.<String>isNull());
        String payload = persisted.getValue();
        assertTrue(payload.contains("\"status\":\"failed\""), "历史终态必须是 failed：" + payload);
        assertTrue(payload.contains("\"toolCallId\":\"call-eye-1\""), "终态必须带关联键：" + payload);
        assertTrue(payload.contains("\"errorCategory\":\"INVALID_OUTPUT\""),
                "失败类别必须进历史，回放才能区分「无效输出」与普通失败：" + payload);

        // 审计：终态既不是 SUCCEEDED，也不是笼统的 TOOL_EXCEPTION
        ArgumentCaptor<ToolStepSink.ToolAuditRecord> records =
                ArgumentCaptor.forClass(ToolStepSink.ToolAuditRecord.class);
        org.mockito.Mockito.verify(audit, org.mockito.Mockito.atLeastOnce()).record(records.capture());
        ToolStepSink.ToolAuditRecord finish = records.getAllValues().stream()
                .filter(r -> r.status() != ToolStepContract.Status.RUNNING)
                .findFirst().orElseThrow();
        assertEquals(ToolStepContract.Status.FAILED, finish.status());
        assertEquals(ToolStepContract.ErrorCategory.INVALID_OUTPUT, finish.errorCategory());

        // 模型收到的是错误响应，而不是一份可当医学依据的分析对象
        assertTrue(model.sawToolError(), "模型必须收到工具失败响应");
        assertFalse(model.toolResponseMentionsAnalysisPayload(),
                "失败调用不能把任何分析字段交给模型");
        assertEquals("这次图片分析没有成功，请稍后再试。", model.finalText());
    }

    @Test
    void validUpstreamJsonIsStillSucceeded() {
        ChatHistoryService history = mock(ChatHistoryService.class);
        ToolAuditService audit = mock(ToolAuditService.class);
        when(audit.digestKey()).thenReturn(new byte[]{9, 9, 9});

        ToolCallingModel model = new ToolCallingModel();
        DiagnosisAgent agent = new DiagnosisAgent();
        ReflectionTestUtils.setField(agent, "chatModel", model);
        TextMcpModelInterceptor mcp = mock(TextMcpModelInterceptor.class);
        when(mcp.resolveMcpCallbacks(any(), any())).thenReturn(new ToolCallback[0]);
        ReflectionTestUtils.setField(agent, "textMcpModelInterceptor", mcp);
        ReflectionTestUtils.setField(agent, "chatHistoryService", history);
        ReflectionTestUtils.setField(agent, "agentImageUploadService", mock(AgentImageUploadService.class));
        ReflectionTestUtils.setField(agent, "agentConstants", constants());
        ReflectionTestUtils.setField(agent, "eyeImageAnalyzerTool", analyzerReturning(VALID));
        ReflectionTestUtils.setField(agent, "documentSearchTool", mock(DocumentSearchTool.class));
        ReflectionTestUtils.setField(agent, "toolAuditService", audit);

        List<MessageDTO> events = agent.stream("看看这张眼底照片", null, "thread-p0-1-ok", USER_ID, null, null)
                .collectList()
                .block(Duration.ofSeconds(60));

        // 对照组：合法结构必须是成功——校验不能写成一律失败。
        assertEquals(1, events.stream()
                        .filter(e -> MessageType.TOOL_RESULT == e.getMessageType())
                        .filter(e -> ToolStepContract.Status.SUCCEEDED.wire().equals(e.getToolStatus()))
                        .count(),
                summarize(events));
        assertTrue(model.sawToolSuccess(), "合法结果必须作为正常结果交给模型");
    }

    private static AgentConstants constants() {
        AgentConstants constants = new AgentConstants();
        constants.setMaxIterations(5);
        constants.setModelCallLimit(5);
        return constants;
    }

    private static final String VALID = """
            {"description":"眼底照片，视盘边界清晰","imageType":"眼底照片",
             "keyFeatures":["视盘边界清晰"],"abnormalities":["未发现明显异常"],
             "medicalKeywords":"fundus, retina","urgency":"normal","recommendations":"定期复查"}
            """;

    /** 真实工具 + 被替换的视觉提供方，其余（COS 读取、归属校验）走真实代码。 */
    private static EyeImageAnalyzerTool analyzerReturning(String visionText) {
        UploadTaskMapper taskMapper = mock(UploadTaskMapper.class);
        UploadTask task = new UploadTask();
        task.setTaskId("task-1");
        task.setUserId(USER_ID);
        task.setObjectKey(IMAGE_KEY);
        task.setStatus(2);
        when(taskMapper.selectByObjectKey(anyLong(), anyString())).thenReturn(task);

        CosManager cosManager = mock(CosManager.class);
        byte[] bytes = {1, 2, 3};
        COSObject object = new COSObject();
        ObjectMetadata metadata = new ObjectMetadata();
        metadata.setContentLength(bytes.length);
        object.setObjectMetadata(metadata);
        object.setObjectContent(new COSObjectInputStream(new ByteArrayInputStream(bytes),
                new org.apache.http.client.methods.HttpGet("http://localhost/test")));
        when(cosManager.getObject(anyString())).thenReturn(object);

        EyeImageAnalyzerTool tool = new EyeImageAnalyzerTool(cosManager, taskMapper);
        ChatModel vision = new ChatModel() {
            @Override
            public ChatResponse call(Prompt prompt) {
                return new ChatResponse(List.of(new Generation(new AssistantMessage(visionText))));
            }

            @Override
            public Flux<ChatResponse> stream(Prompt prompt) {
                return Flux.just(call(prompt));
            }
        };
        ReflectionTestUtils.setField(tool, "visionChatClient", ChatClient.builder(vision).build());
        return tool;
    }

    private static String summarize(List<MessageDTO> events) {
        StringBuilder sb = new StringBuilder();
        for (MessageDTO e : events) {
            sb.append('[').append(e.getMessageType()).append('/').append(e.getToolStatus())
                    .append('/').append(e.getErrorCategory()).append("] ");
        }
        return sb.toString();
    }

    /** 第一次请求 analyzeEyeImage，看到工具响应后收尾。 */
    private static final class ToolCallingModel implements ChatModel {

        private final AtomicInteger calls = new AtomicInteger();
        private final List<List<Message>> prompts = Collections.synchronizedList(new ArrayList<>());
        private volatile String finalText;
        private volatile boolean sawToolError;
        private volatile boolean sawToolSuccess;

        @Override
        public ChatResponse call(Prompt prompt) {
            return next(prompt);
        }

        @Override
        public Flux<ChatResponse> stream(Prompt prompt) {
            return Flux.just(next(prompt));
        }

        private ChatResponse next(Prompt prompt) {
            List<Message> instructions = List.copyOf(prompt.getInstructions());
            prompts.add(instructions);
            instructions.stream()
                    .filter(m -> m instanceof ToolResponseMessage)
                    .map(m -> (ToolResponseMessage) m)
                    .flatMap(m -> m.getResponses().stream())
                    .forEach(r -> {
                        String data = r.responseData() == null ? "" : r.responseData();
                        // 失败路径给模型的是一句固定的错误说明；成功路径是结构化分析对象。
                        if (data.contains("图像分析")) sawToolError = true;
                        if (data.contains("视盘边界清晰")) sawToolSuccess = true;
                    });
            if (calls.incrementAndGet() == 1) {
                AssistantMessage request = AssistantMessage.builder()
                        .content("")
                        .toolCalls(List.of(new AssistantMessage.ToolCall(
                                "call-eye-1", "function", "analyzeEyeImage",
                                "{\"imageId\":\"" + IMAGE_KEY + "\"}")))
                        .build();
                return new ChatResponse(List.of(new Generation(request)));
            }
            finalText = sawToolError ? "这次图片分析没有成功，请稍后再试。" : "分析完成。";
            return new ChatResponse(List.of(new Generation(new AssistantMessage(finalText))));
        }

        boolean sawToolError() {
            return sawToolError;
        }

        boolean sawToolSuccess() {
            return sawToolSuccess;
        }

        boolean toolResponseMentionsAnalysisPayload() {
            return prompts.stream()
                    .flatMap(List::stream)
                    .filter(m -> m instanceof ToolResponseMessage)
                    .map(m -> (ToolResponseMessage) m)
                    .flatMap(m -> m.getResponses().stream())
                    .map(r -> r.responseData() == null ? "" : r.responseData())
                    .anyMatch(data -> data.contains("视盘") || data.contains("attention") || data.contains("urgency"));
        }

        String finalText() {
            return finalText;
        }
    }
}
