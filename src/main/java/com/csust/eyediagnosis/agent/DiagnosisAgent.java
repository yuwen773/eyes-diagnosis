package com.csust.eyediagnosis.agent;

import com.alibaba.cloud.ai.graph.NodeOutput;
import com.alibaba.cloud.ai.graph.RunnableConfig;
import com.alibaba.cloud.ai.graph.action.InterruptionMetadata;
import com.alibaba.cloud.ai.graph.agent.ReactAgent;
import com.alibaba.cloud.ai.graph.streaming.StreamingOutput;
import com.csust.eyediagnosis.agent.config.AgentConstants;
import com.csust.eyediagnosis.agent.interceptor.TextMcpModelInterceptor;
import com.csust.eyediagnosis.agent.service.ChatHistoryService;
import com.csust.eyediagnosis.agent.service.ToolAuditService;
import com.csust.eyediagnosis.agent.tools.DocumentSearchTool;
import com.csust.eyediagnosis.agent.tools.EyeImageAnalyzerTool;
import com.csust.eyediagnosis.agent.tools.UserBoundDocumentSearchTool;
import com.csust.eyediagnosis.agent.tools.UserBoundEyeImageAnalyzerTool;
import com.csust.eyediagnosis.model.dto.agent.AgentChatRequest;
import com.csust.eyediagnosis.model.dto.agent.MessageDTO;
import com.csust.eyediagnosis.model.dto.agent.MessageType;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 眼科诊断Agent
 * 支持MCP工具调用、流式输出、对话历史管理
 */
@Slf4j
@Component
public class DiagnosisAgent {

    private static final String SYSTEM_PROMPT = """
你是一个专业的眼科AI诊断助手。

## 核心职责
1. 通过问诊收集患者的症状、视力问题、眼部不适等信息
2. 根据收集的信息评估可能的眼部疾病（给出参考建议，不做最终诊断）
3. 解读用户上传的眼底照片、验光单等检查报告
4. 提供眼部护理建议和就医指导

## 工作流程
### 问诊阶段
- 使用开放式问题收集症状：「您有什么眼部不适？」
- 确认关键信息：视力变化、眼疼、流泪、闪光感等
- 如有需要可以查询医学知识库

### 报告解读阶段
- 用户上传眼底照片时，分析照片中的异常
- 识别照片中的问题并给出初步评估

### 满意度询问
「这些信息对您有帮助吗？是否有其他问题需要进一步解答？」

## 约束
- 不直接确诊，只提供参考建议
- 强调「建议就医」的重要性，尤其是症状严重时
- 涉及手术、处方等必须建议专业就诊
- 保护用户隐私，谨慎处理敏感医学信息

## 工具使用
当需要查询医学知识时可以调用MCP工具。

### RAG 工具
- 当需要查找专业眼科医学知识时，使用 searchDocuments 工具搜索知识库。
- 基于检索到的信息回答问题时，请引用来源。
""";

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
    private ToolAuditService toolAuditService;

    private ReactAgent buildAgent(ToolCallback[] extraTools, Long userId, ToolStepSink sink) {
        var builder = ReactAgent.builder()
                .name("eye_diagnosis_assistant")
                .model(chatModel)
                .instruction(SYSTEM_PROMPT)
                .methodTools(new UserBoundEyeImageAnalyzerTool(eyeImageAnalyzerTool, userId),
                        new UserBoundDocumentSearchTool(documentSearchTool, userId));
        if (extraTools != null && extraTools.length > 0) {
            builder.tools(extraTools);
        }
        // Per-request interceptor: observes real tool execution for status + audit.
        builder.interceptors(new ToolExecutionInterceptor(sink, toolAuditService.digestKey()));
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

        // 每个请求独立一个 sink/拦截器：不同会话、不同工具卡不会串台。
        ToolStepSink sink = new ToolStepSink(threadId, userId, toolAuditService::record);
        ReactAgent activeAgent = buildAgent(mcpCallbacks, userId, sink);

        RunnableConfig config = RunnableConfig.builder()
                .threadId(threadId)
                .build();

        try {
            Flux<NodeOutput> stream = activeAgent.stream(fullMessage, config);

            StringBuilder assistantContent = new StringBuilder();
            StringBuilder reasoningContent = new StringBuilder();

            Flux<MessageDTO> graphEvents = stream
                    .filter(output -> {
                        if (output instanceof StreamingOutput<?> so) {
                            String typeName = so.getOutputType() != null ? so.getOutputType().name() : "";
                            return !"AGENT_MODEL_FINISHED".equals(typeName)
                                && !"AGENT_HOOK_FINISHED".equals(typeName);
                        }
                        return true;
                    })
                    .mapNotNull(output -> {
                        if (output instanceof StreamingOutput<?> streamingOutput) {
                            Object msg = streamingOutput.message();
                            if (msg instanceof AssistantMessage assistantMessage) {
                                MessageDTO messageDTO = new MessageDTO();
                                Map<String, Object> metadata = assistantMessage.getMetadata();

                                // 工具请求：只给浏览器白名单标签和状态，不把参数原文落库。
                                if (assistantMessage.hasToolCalls()) {
                                    String prevReasoning = reasoningContent.toString();
                                    if (agentConstants.isExposeReasoning() && !prevReasoning.isEmpty()) {
                                        chatHistoryService.saveReasoningMessage(threadId, userId, prevReasoning);
                                        reasoningContent.setLength(0);
                                    }
                                    messageDTO.setMessageType(MessageType.TOOL_REQUEST);
                                    messageDTO.setContent("");
                                    List<Map<String, Object>> toolCallingList = new ArrayList<>();
                                    StringBuilder redactedDesc = new StringBuilder();
                                    for (AssistantMessage.ToolCall toolCall : assistantMessage.getToolCalls()) {
                                        Map<String, Object> tcMap = new HashMap<>();
                                        tcMap.put("name", toolCall.name());
                                        // SSE 给浏览器保留参数供展示；落库文本走白名单脱敏，两者分离。
                                        tcMap.put("arguments", toolCall.arguments());
                                        tcMap.put("id", toolCall.id());
                                        tcMap.put("stepLabel", ToolStepContract.stepLabel(toolCall.name()));
                                        toolCallingList.add(tcMap);
                                        if (redactedDesc.length() > 0) redactedDesc.append("\n");
                                        redactedDesc.append(redactedToolCall(toolCall.name()));
                                    }
                                    messageDTO.setToolCalls(toolCallingList);
                                    messageDTO.setToolStatus(ToolStepContract.Status.RUNNING.wire());
                                    messageDTO.setStepLabel(toolCallingList.size() == 1
                                            ? ToolStepContract.stepLabel(assistantMessage.getToolCalls().get(0).name())
                                            : null);
                                    chatHistoryService.saveToolCallMessage(threadId, userId, redactedDesc.toString());
                                }
                                // reasoning 消息：默认不展示、不落库（见 agent.expose-reasoning）
                                else if (metadata.get("reasoningContent") != null
                                        && !"".equals(metadata.get("reasoningContent"))) {
                                    if (!agentConstants.isExposeReasoning()) return null;
                                    String reasoningText = (String) metadata.get("reasoningContent");
                                    reasoningContent.append(reasoningText);
                                    messageDTO.setContent(reasoningText);
                                    messageDTO.setMessageType(MessageType.REASONING);
                                }
                                // 普通文本消息：不是工具执行结果，绝不据此推断工具成功。
                                else {
                                    String text = assistantMessage.getText();
                                    assistantContent.append(text);
                                    messageDTO.setContent(text);
                                    messageDTO.setMessageType(MessageType.ASSISTANT);
                                }
                                return messageDTO;
                            }
                        } else if (output instanceof InterruptionMetadata interruptionMetadata) {
                            MessageDTO messageDTO = new MessageDTO();
                            messageDTO.setMessageType(MessageType.TOOL_CONFIRM);
                            messageDTO.setToolStatus(ToolStepContract.Status.AWAITING_CONFIRM.wire());
                            StringBuilder sb = new StringBuilder();
                            StringBuilder persisted = new StringBuilder();
                            List<InterruptionMetadata.ToolFeedback> feedbacks = interruptionMetadata.toolFeedbacks();
                            for (InterruptionMetadata.ToolFeedback feedback : feedbacks) {
                                sb.append("工具: ").append(feedback.getName()).append("\n");
                                sb.append("评估: ").append(feedback.getDescription()).append("\n");
                                // 落库只保留固定白名单标签，不写模型生成的评估描述
                                // （其中可能带参数原文、患者信息或完整 Prompt）。
                                if (persisted.length() > 0) persisted.append("\n");
                                persisted.append(redactedToolCall(feedback.getName()));
                            }
                            if (feedbacks.size() == 1) {
                                messageDTO.setToolCallId(feedbacks.get(0).getId());
                                messageDTO.setStepLabel(ToolStepContract.stepLabel(feedbacks.get(0).getName()));
                            }
                            messageDTO.setContent(sb.toString());
                            chatHistoryService.saveToolConfirmMessage(threadId, userId, persisted.toString());
                            return messageDTO;
                        }
                        return null;
                    })
                    .doOnComplete(() -> {
                        String fullReasoning = reasoningContent.toString();
                        if (agentConstants.isExposeReasoning() && !fullReasoning.isEmpty()) {
                            chatHistoryService.saveReasoningMessage(threadId, userId, fullReasoning);
                        }
                        String fullResponse = assistantContent.toString();
                        if (!fullResponse.isEmpty()) {
                            chatHistoryService.saveAssistantMessage(threadId, userId, fullResponse, "text");
                        }
                    });

            // 状态事件来自真实工具执行（拦截器），与图事件合并后按同一 SSE 通道下发。
            Flux<MessageDTO> statusEvents = sink.events().asFlux();

            // 图流终止（正常结束 / 报错 / 浏览器取消）时关闭 sink：仍未拿到真实结果的
            // 调用一律 CANCELLED，绝不在缺结果时呈现成功。必须由 graphEvents 自己触发，
            // 放在合并流的 doFinally 会形成循环等待（statusEvents 还开着）。
            Flux<MessageDTO> boundedGraphEvents = graphEvents
                    .doOnComplete(sink::closePending)
                    .doOnError(e -> sink.closePending())
                    .doOnCancel(sink::closePending);

            return Flux.merge(boundedGraphEvents, statusEvents);
        } catch (Exception e) {
            sink.closePending();
            log.error("流式对话执行异常, threadId={}", threadId, e);
            return Flux.error(new RuntimeException("Agent流式执行失败", e));
        }
    }

    /**
     * 历史落库用的脱敏工具调用文本：只有白名单工具名 + 固定标签。
     * 模型生成的参数 JSON、评估描述、自由文本一律不进 t_agent_message。
     * package-visible 以便针对性单测验证无敏感原文泄漏。
     */
    static String redactedToolCall(String toolName) {
        return ToolStepContract.stepLabel(toolName);
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
