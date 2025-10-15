package com.csust.eyediagnosis.utils;

import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONUtil;
import com.csust.eyediagnosis.ai.model.enums.StreamMessageTypeEnum;
import com.csust.eyediagnosis.ai.model.message.AiReasoningMessage;
import com.csust.eyediagnosis.ai.model.message.AiResponseMessage;
import com.csust.eyediagnosis.ai.model.message.StreamMessage;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.enums.ChatHistoryMessageTypeEnum;
import com.csust.eyediagnosis.service.ChatHistoryService;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.model.chat.response.ChatResponse;
import dev.langchain4j.model.chat.response.PartialThinking;
import dev.langchain4j.service.TokenStream;
import dev.langchain4j.service.tool.ToolExecution;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.codec.ServerSentEvent;
import reactor.core.publisher.Flux;

import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * @ ClassName TokenStreamUtils
 * @ Description tokenStream 流处理器
 * @ Author 钰玟
 * @ Date 2025/9/19 下午3:52
 * Version 1.0
 **/
@Slf4j
public class TokenStreamUtils {
    /**
     * 处理tokenStream 适配 为 Flux
     * 统一处理为 {@link com.csust.eyediagnosis.ai.model.message.StreamMessage }
     * 指定为特定的 消息类型
     * @param tokenStream tokenStream
     * @return Flux
     */
    public static Flux<String> tokenStreamAdaptFlux(TokenStream tokenStream) {
        AtomicBoolean isThinking = new AtomicBoolean(true);
        AtomicBoolean NotThinking = new AtomicBoolean(true);
        return Flux.create(sink->{
            tokenStream.onPartialResponse((String partialResponse) -> {
                        String response = partialResponse;
                        AiResponseMessage aiResponseMessage = new AiResponseMessage("");
                        if(NotThinking.get()) {
                            response = String.format("%s</think>", response);
                            aiResponseMessage.setContent(response);
                            NotThinking.set(false);
                        }else{
                            aiResponseMessage.setContent(response);
                        }
                        sink.next(JSONUtil.toJsonStr(aiResponseMessage));
                    })
                    .onPartialThinking((PartialThinking partialThinking) -> {
                        String thinkingText = partialThinking.text();
                        AiReasoningMessage aiReasoningMessage = new AiReasoningMessage("");
                        if(isThinking.get()) {
                            thinkingText = String.format("<think>%s", thinkingText);
                            aiReasoningMessage.setContent(thinkingText);
                            isThinking.set(false);
                        }else{
                            aiReasoningMessage.setContent(thinkingText);
                        }
                        sink.next(JSONUtil.toJsonStr(aiReasoningMessage));
                    })
                    .onIntermediateResponse((ChatResponse intermediateResponse) -> {
                        String thinking = intermediateResponse.aiMessage().thinking();
                        System.err.println( thinking);
                    })
                    .beforeToolExecution((beforeToolExecution) -> {
                        ToolExecutionRequest request = beforeToolExecution.request();
                    })
                    .onToolExecuted((ToolExecution toolExecution) -> {
                    })
                    .onCompleteResponse((ChatResponse response) -> {
                        sink.complete();
                    })
                    .onError((Throwable error) -> {
                        error.printStackTrace();
                        sink.error(error);
                    })
                    .start();
        });
    }

    /**
     * 处理流
     * @param originFlux 原始流
     * @param chatHistoryService 对话历史服务
     * @return 处理后的流
     */
    public static Flux<String> handle(Flux<String> originFlux, Long sessionId
            , ChatHistoryService chatHistoryService, User loginUser) {
        //定义好 文本拼接器
        StringBuilder contentBuilder = new StringBuilder();
        //处理 原始流
        return originFlux.map(chunk->{
                    // 解析每个 JSON 消息块 为AiResponse
                    AiResponse aiResponse = JSONUtil.toBean(handleJsonMessageChunk(chunk), AiResponse.class);
                    String content = aiResponse.content;
                    // 收集完整信息方便前端进行显示
                    contentBuilder.append(content);
                    //还要进行处理 ， 不同的消息 ，使用事件区分
                    return content;
                })
                .filter(StrUtil::isNotEmpty) // 过滤空字串
                .doOnComplete(() -> {
                    // 流式响应完成后，添加 AI 消息到对话历史
                    String aiResponse = contentBuilder.toString();
                    if(StrUtil.isNotBlank(aiResponse)) {
                        //添加 AI消息
                        chatHistoryService.addChatMessage(sessionId, aiResponse, ChatHistoryMessageTypeEnum.AI.getValue(), loginUser.getId());
                    }

                })
                .doOnError(error -> {
                    // 如果AI回复失败，也要记录错误消息
                    String errorMessage = "AI回复失败: " + error.getMessage();
                    log.error(errorMessage);
                    chatHistoryService.addChatMessage(sessionId, errorMessage, ChatHistoryMessageTypeEnum.AI.getValue(), loginUser.getId());
                });
    }
    /**
     * 解析并收集 TokenStream 数据
     * @param chunk 数据块
     * @return 处理后的数据块
     */
    private static String handleJsonMessageChunk(String chunk) {
        // 解析 JSON，先还原为基类  StreamMessage
        StreamMessage streamMessage = JSONUtil.toBean(chunk, StreamMessage.class);
        //继而根据基类的 type字段获取具体消息类型
        StreamMessageTypeEnum typeEnum = StreamMessageTypeEnum.getEnumByValue(streamMessage.getType());
        switch (typeEnum) {
            case AI_RESPONSE -> {
                AiResponseMessage aiMessage = JSONUtil.toBean(chunk, AiResponseMessage.class);
                String content = aiMessage.getContent();
                return getAiMsgJson(content, typeEnum);
            }
            case AI_REASONING -> {
                AiReasoningMessage toolRequestMessage = JSONUtil.toBean(chunk, AiReasoningMessage.class);
                String reasoningContent = toolRequestMessage.getContent();
                return getAiMsgJson(reasoningContent, typeEnum);
            }
            default -> {
                log.error("不支持的消息类型: {}", typeEnum);
                return "";
            }
        }
    }

        /**
         * 得到 {@link AiResponse} 的JSON格式
         * @param content 消息内容
         * @param typeEnum 消息类型
         * @return JSON格式的消息
         */
        private static String getAiMsgJson(String content, StreamMessageTypeEnum typeEnum) {
            AiResponse aiResponse = AiResponse.builder().content(content).type(typeEnum.getValue()).build();
            return JSONUtil.toJsonStr(aiResponse);
        }

        // AiResponse 解决Ai 学习消息历史（包含工具调用）从而 “偷懒” 假装调用了工具
        @Data
        @Builder
        @NoArgsConstructor
        @AllArgsConstructor
        public static class AiResponse {
            private String content;

            /**
             * @see StreamMessageTypeEnum
             */
            private String type;
        }
}
