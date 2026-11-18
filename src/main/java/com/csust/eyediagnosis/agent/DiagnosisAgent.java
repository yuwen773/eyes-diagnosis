package com.csust.eyediagnosis.agent;

import com.alibaba.cloud.ai.graph.NodeOutput;
import com.alibaba.cloud.ai.graph.RunnableConfig;
import com.alibaba.cloud.ai.graph.action.InterruptionMetadata;
import com.alibaba.cloud.ai.graph.agent.ReactAgent;
import com.alibaba.cloud.ai.graph.streaming.OutputType;
import com.alibaba.cloud.ai.graph.streaming.StreamingOutput;
import com.csust.eyediagnosis.agent.config.AgentConstants;
import com.csust.eyediagnosis.agent.interceptor.TextMcpModelInterceptor;
import com.csust.eyediagnosis.agent.observability.ToolExecutionObserver;
import com.csust.eyediagnosis.agent.service.ChatHistoryService;
import com.csust.eyediagnosis.agent.tools.DocumentSearchTool;
import com.csust.eyediagnosis.agent.tools.EyeImageAnalyzerTool;
import com.csust.eyediagnosis.agent.tools.UserBoundDocumentSearchTool;
import com.csust.eyediagnosis.model.dto.agent.AgentChatRequest;
import com.csust.eyediagnosis.model.dto.agent.MessageDTO;
import com.csust.eyediagnosis.model.dto.agent.MessageType;
import com.csust.eyediagnosis.utils.SensitiveDataRedactor;
import com.csust.eyediagnosis.utils.TimeFormats;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.ToolResponseMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * 眼科诊断Agent
 * 支持MCP工具调用、流式输出、对话历史管理
 */
@Slf4j
@Component
public class DiagnosisAgent {

    private static final String SYSTEM_PROMPT = """
你是 Iris，一名眼科 AI 助手。

回答要像一位耐心的临床助手：先说结论或下一步，再补依据；短问题短答，
需要展开时用小标题和要点，不要复述这份职责清单。只在必要时提出一个澄清问题。

## 边界
- 给出参考判断，不做最终诊断，不替代医生面诊。
- 症状严重、视力骤降、视野缺损、剧烈眼痛、外伤或术后异常时，明确建议尽快就医/急诊。
- 涉及手术、处方、用药剂量时，建议由专业医生评估，不自行给出方案。
- 谨慎处理隐私与敏感医学信息；不把模型推理当作医学证据。

## 工具
- 需要专业眼科知识时，调用 searchDocuments 检索知识库，并引用检索到的来源。
- 用户上传眼底照片时，按要求分析图像；图像分析结果只作为参考线索。
""";

    /** 单条工具结果进入 SSE / 历史的最大字符数：保留可核对的主体，避免异常大对象撑爆传输与页面。 */
    private static final int MAX_TOOL_RESULT_CHARS = 32_000;

    @Resource
    private ChatModel chatModel;

    @Resource
    private TextMcpModelInterceptor textMcpModelInterceptor;

    @Resource
    private ChatHistoryService chatHistoryService;

    @Resource
    private AgentConstants agentConstants;

    @Resource
    private EyeImageAnalyzerTool eyeImageAnalyzerTool;

    @Resource
    private DocumentSearchTool documentSearchTool;

    @Resource
    private ToolExecutionObserver toolExecutionObserver;

    @Resource
    private ObjectMapper objectMapper;

    private ReactAgent buildAgent(ToolCallback[] extraTools, Long userId) {
        var builder = ReactAgent.builder()
                .name("eye_diagnosis_assistant")
                .model(chatModel)
                .instruction(SYSTEM_PROMPT)
                // 旁路观察工具结果：只记录，不改变工具行为。没有观察记录时
                // 前端只能标「已返回、未区分成败」，不会退化成假成功。
                .interceptors(toolExecutionObserver)
                .methodTools(eyeImageAnalyzerTool,
                        new UserBoundDocumentSearchTool(documentSearchTool, userId));
        if (extraTools != null && extraTools.length > 0) {
            builder.tools(extraTools);
        }
        return builder.build();
    }

    /**
     * 流式对话入口（支持MCP）
     */
    public Flux<MessageDTO> stream(String userMessage, List<String> imageUrls, String threadId, Long userId,
                                   List<String> enabledMcpServers, Boolean disableMcpDefault) {
        // Agent 运行前再校验一次会话所有权，防止 Controller 路径被绕过
        chatHistoryService.assertSessionOwner(threadId, userId);
        // 用户消息由 Controller 在入口处持久化（同步队列），此处不再重复写入。
        String fullMessage = buildUserMessage(userMessage, imageUrls);

        // 解析MCP回调
        AgentChatRequest chatRequest = new AgentChatRequest();
        chatRequest.setEnabledMcpServers(enabledMcpServers);
        chatRequest.setDisableMcpDefault(disableMcpDefault);
        ToolCallback[] mcpCallbacks = textMcpModelInterceptor.resolveMcpCallbacks(chatRequest, userId);

        // 选择 Agent：无 MCP 用内置 agent，有 MCP 创建 combined agent
        ReactAgent activeAgent = buildAgent(mcpCallbacks, userId);

        RunnableConfig config = RunnableConfig.builder()
                .threadId(threadId)
                .build();

        try {
            Flux<NodeOutput> stream = activeAgent.stream(fullMessage, config);

            StringBuilder assistantContent = new StringBuilder();
            StringBuilder reasoningContent = new StringBuilder();
            // 同一 toolCallId 只发一次结果：框架可能同时给 STREAMING / FINISHED，
            // 重复卡片会让用户以为工具跑了两遍。
            Set<String> emittedToolResults = ConcurrentHashMap.newKeySet();

            return stream
                    .filter(output -> {
                        if (output instanceof StreamingOutput<?> so) {
                            String typeName = so.getOutputType() != null ? so.getOutputType().name() : "";
                            return !"AGENT_MODEL_FINISHED".equals(typeName)
                                && !"AGENT_HOOK_FINISHED".equals(typeName);
                        }
                        return true;
                    })
                    .concatMapIterable(output -> toEventDtos(
                            output, threadId, userId, assistantContent, reasoningContent, emittedToolResults))
                    .doOnComplete(() -> {
                        String fullReasoning = reasoningContent.toString();
                        if (!fullReasoning.isEmpty()) {
                            chatHistoryService.saveReasoningMessage(threadId, userId, fullReasoning);
                        }
                        String fullResponse = assistantContent.toString();
                        if (!fullResponse.isEmpty()) {
                            chatHistoryService.saveAssistantMessage(threadId, userId, fullResponse, "text");
                        }
                    });
        } catch (Exception e) {
            log.error("流式对话执行异常, threadId={}", threadId, e);
            return Flux.error(new RuntimeException("Agent流式执行失败", e));
        }
    }

    /**
     * 单个图输出 → 0..n 个 SSE 事件。
     *
     * <p>工具结果是 {@link ToolResponseMessage}，不是 {@link AssistantMessage}；
     * 旧实现只处理后者，导致工具结果被静默丢弃。这里保留框架原生的
     * {@code AGENT_TOOL_FINISHED} 节点输出，按 {@code toolCallId} 发回前端。
     *
     * <p>包级可见，便于用框架原生的 {@link StreamingOutput} 直接验证事件映射。
     */
    List<MessageDTO> toEventDtos(NodeOutput output, String threadId, Long userId,
                                         StringBuilder assistantContent, StringBuilder reasoningContent,
                                         Set<String> emittedToolResults) {
        List<MessageDTO> events = new ArrayList<>();

        if (output instanceof StreamingOutput<?> streamingOutput) {
            Object msg = streamingOutput.message();
            OutputType outputType = streamingOutput.getOutputType();

            if (msg instanceof AssistantMessage assistantMessage) {
                events.add(toAssistantEvent(assistantMessage, threadId, userId,
                        assistantContent, reasoningContent));
                return events;
            }

            if (msg instanceof ToolResponseMessage toolResponseMessage) {
                // 只认完成态：STREAMING 可能是分片，按分片落库会写出半截结果。
                // 内置工具是同步的，完成态一定到达；流式工具若未来接入，
                // 这里需要改成「按 id 缓冲到 FINISHED 再发」。
                if (outputType != OutputType.AGENT_TOOL_FINISHED) {
                    return events;
                }
                for (ToolResponseMessage.ToolResponse response : toolResponseMessage.getResponses()) {
                    String content = truncateToolResult(
                            SensitiveDataRedactor.redact(response.responseData()));
                    String toolCallId = response.id();
                    if (toolCallId != null && !emittedToolResults.add(toolCallId)) {
                        continue;
                    }
                    String status = resolveToolStatus(toolCallId);

                    MessageDTO dto = new MessageDTO();
                    dto.setMessageType(MessageType.TOOL_RESULT);
                    dto.setContent(content);
                    dto.setToolCallId(toolCallId);
                    dto.setToolName(response.name());
                    dto.setStatus(status);
                    dto.setTimestamp(TimeFormats.nowIsoOffset());
                    events.add(dto);

                    persistToolResult(threadId, userId, toolCallId, response.name(), status, content);
                }
                return events;
            }

            return events;
        }

        if (output instanceof InterruptionMetadata interruptionMetadata) {
            MessageDTO dto = new MessageDTO();
            dto.setMessageType(MessageType.TOOL_CONFIRM);
            StringBuilder sb = new StringBuilder();
            for (InterruptionMetadata.ToolFeedback feedback : interruptionMetadata.toolFeedbacks()) {
                sb.append("工具: ").append(feedback.getName()).append("\n");
                sb.append("评估: ").append(feedback.getDescription()).append("\n");
            }
            dto.setContent(sb.toString());
            dto.setTimestamp(TimeFormats.nowIsoOffset());
            chatHistoryService.saveToolConfirmMessage(threadId, userId, sb.toString());
            events.add(dto);
            return events;
        }

        return events;
    }

    private MessageDTO toAssistantEvent(AssistantMessage assistantMessage, String threadId, Long userId,
                                        StringBuilder assistantContent, StringBuilder reasoningContent) {
        MessageDTO messageDTO = new MessageDTO();
        messageDTO.setTimestamp(TimeFormats.nowIsoOffset());
        Map<String, Object> metadata = assistantMessage.getMetadata();

        // 工具调用消息
        if (assistantMessage.hasToolCalls()) {
            String prevReasoning = reasoningContent.toString();
            if (!prevReasoning.isEmpty()) {
                chatHistoryService.saveReasoningMessage(threadId, userId, prevReasoning);
                reasoningContent.setLength(0);
            }
            messageDTO.setMessageType(MessageType.TOOL_REQUEST);
            messageDTO.setContent(assistantMessage.getText());
            List<Map<String, Object>> toolCallingList = assistantMessage.getToolCalls().stream()
                    .map(toolCall -> {
                        Map<String, Object> tcMap = new LinkedHashMap<>();
                        // toolCallId 是请求与结果唯一的稳定关联键。
                        tcMap.put("id", toolCall.id());
                        tcMap.put("name", toolCall.name());
                        tcMap.put("arguments", toolCall.arguments());
                        return tcMap;
                    }).toList();
            messageDTO.setToolCalls(toolCallingList);
            for (Map<String, Object> tc : toolCallingList) {
                persistToolCall(threadId, userId,
                        (String) tc.get("id"), (String) tc.get("name"), (String) tc.get("arguments"));
            }
        }
        // reasoning 消息
        else if (metadata.get("reasoningContent") != null
                && !"".equals(metadata.get("reasoningContent"))) {
            String reasoningText = (String) metadata.get("reasoningContent");
            reasoningContent.append(reasoningText);
            messageDTO.setContent(reasoningText);
            messageDTO.setMessageType(MessageType.REASONING);
        }
        // 普通文本消息
        else {
            String text = assistantMessage.getText();
            assistantContent.append(text);
            messageDTO.setContent(text);
            messageDTO.setMessageType(MessageType.ASSISTANT);
        }
        return messageDTO;
    }

    /**
     * 结果状态只取观察到的真实值。收到响应却查不到观察记录时标
     * {@code completed}——「框架返回了结果」≠「工具执行成功」。
     */
    private String resolveToolStatus(String toolCallId) {
        ToolExecutionObserver.Outcome outcome = toolExecutionObserver.peek(toolCallId);
        return outcome != null ? outcome.status() : "completed";
    }

    private String truncateToolResult(String content) {
        if (content == null) {
            return "";
        }
        if (content.length() <= MAX_TOOL_RESULT_CHARS) {
            return content;
        }
        return content.substring(0, MAX_TOOL_RESULT_CHARS) + "\n…（工具结果过长，已截断）";
    }

    /**
     * 工具调用落库格式（带 toolCallId，便于历史回放时精确配对）：
     * {@code {"toolCallId":"…","name":"…","arguments":"…"}}。
     * 旧数据仍是「name: arguments」，前端解析器两种都认。
     */
    private void persistToolCall(String threadId, Long userId, String toolCallId, String name, String arguments) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("toolCallId", toolCallId);
        payload.put("name", name);
        payload.put("arguments", arguments);
        chatHistoryService.saveToolCallMessage(threadId, userId, toJson(payload));
    }

    /** 工具结果落库格式：{@code {"toolCallId","name","status","output"}}。 */
    private void persistToolResult(String threadId, Long userId, String toolCallId, String name,
                                   String status, String output) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("toolCallId", toolCallId);
        payload.put("name", name);
        payload.put("status", status);
        payload.put("output", output);
        chatHistoryService.saveToolResultMessage(threadId, userId, toJson(payload));
    }

    private String toJson(Map<String, Object> payload) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException e) {
            // 极端情况下退化成可读文本，至少不丢这次工具活动。
            log.warn("工具事件序列化失败, keys={}", payload.keySet());
            return payload.entrySet().stream()
                    .map(entry -> entry.getKey() + "=" + entry.getValue())
                    .collect(Collectors.joining("\n"));
        }
    }

    /**
     * 构建带有图片分析标签的用户消息
     */
    private String buildUserMessage(String userMessage, List<String> imageUrls) {
        if (imageUrls == null || imageUrls.isEmpty()) {
            return userMessage != null ? userMessage : "";
        }
        StringBuilder sb = new StringBuilder();
        for (String url : imageUrls) {
            sb.append("<image-analysis>").append(url).append("</image-analysis>\n");
        }
        sb.append("\n").append(userMessage != null ? userMessage : "");
        return sb.toString();
    }
}
