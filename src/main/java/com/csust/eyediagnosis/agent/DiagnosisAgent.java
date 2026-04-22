package com.csust.eyediagnosis.agent;

import com.csust.eyediagnosis.agent.config.AgentConstants;
import com.csust.eyediagnosis.agent.interceptor.TextMcpModelInterceptor;
import com.csust.eyediagnosis.agent.service.ChatHistoryService;
import com.csust.eyediagnosis.model.dto.agent.AgentChatRequest;
import com.csust.eyediagnosis.model.dto.agent.MessageDTO;
import com.csust.eyediagnosis.model.dto.agent.MessageType;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.StreamingChatModel;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;

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
""";

    @Resource
    private ChatModel chatModel;

    @Resource
    private StreamingChatModel streamingChatModel;

    @Resource
    private TextMcpModelInterceptor textMcpModelInterceptor;

    @Resource
    private ChatHistoryService chatHistoryService;

    @Resource
    private AgentConstants agentConstants;

    /**
     * 流式对话入口（支持MCP）
     */
    public Flux<MessageDTO> stream(String userMessage, List<String> imageUrls, String threadId, Long userId,
                                   List<String> enabledMcpServers, Boolean disableMcpDefault) {
        String fullMessage = buildUserMessage(userMessage, imageUrls);
        chatHistoryService.saveUserMessage(threadId, userId, fullMessage);

        // 解析MCP回调
        AgentChatRequest chatRequest = new AgentChatRequest();
        chatRequest.setEnabledMcpServers(enabledMcpServers);
        chatRequest.setDisableMcpDefault(disableMcpDefault);
        ToolCallback[] mcpCallbacks = textMcpModelInterceptor.resolveMcpCallbacks(chatRequest, userId);

        // 构建消息列表
        List<dev.langchain4j.data.message.ChatMessage> messages =
            List.of(new dev.langchain4j.data.message.SystemMessage(SYSTEM_PROMPT),
                    new dev.langchain4j.data.message.UserMessage(fullMessage));

        try {
            Flux<dev.langchain4j.data.message.ChatMessage> stream;

            if (mcpCallbacks != null && mcpCallbacks.length > 0) {
                // MCP工具调用模式
                stream = streamingChatModel.stream(messages,
                    dev.langchain4j.model.chat.request.ChatRequest.builder()
                        .tools(List.of(mcpCallbacks))
                        .build());
            } else {
                // 普通模式
                stream = streamingChatModel.stream(messages);
            }

            final StringBuilder assistantContent = new StringBuilder();

            return stream
                    .filter(msg -> msg != null)
                    .map(msg -> {
                        MessageDTO messageDTO = new MessageDTO();

                        if (msg instanceof dev.langchain4j.data.message.AiMessage aiMsg) {
                            // 处理工具调用
                            if (aiMsg.hasToolCalls()) {
                                messageDTO.setMessageType(MessageType.TOOL_REQUEST);
                                messageDTO.setContent(aiMsg.getText());
                                List<Map<String, Object>> toolCallingList = aiMsg.getToolCalls().stream()
                                        .map(tc -> {
                                            Map<String, Object> tcMap = new HashMap<>();
                                            tcMap.put("name", tc.name());
                                            tcMap.put("arguments", tc.arguments());
                                            return tcMap;
                                        }).toList();
                                messageDTO.setToolCalls(toolCallingList);
                                String toolDesc = toolCallingList.stream()
                                        .map(tc -> tc.get("name") + ": " + tc.get("arguments"))
                                        .collect(Collectors.joining("\n"));
                                chatHistoryService.saveToolCallMessage(threadId, toolDesc);
                            } else {
                                // 普通文本
                                String text = aiMsg.getText();
                                assistantContent.append(text);
                                messageDTO.setContent(text);
                                messageDTO.setMessageType(MessageType.ASSISTANT);
                            }
                        }
                        return messageDTO;
                    })
                    .doOnComplete(() -> {
                        String fullResponse = assistantContent.toString();
                        if (!fullResponse.isEmpty()) {
                            chatHistoryService.saveAssistantMessage(threadId, fullResponse, "text");
                        }
                    });
        } catch (Exception e) {
            log.error("流式对话执行异常, threadId={}", threadId, e);
            return Flux.error(new RuntimeException("Agent流式执行失败", e));
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