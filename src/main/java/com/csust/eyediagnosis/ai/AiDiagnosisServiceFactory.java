package com.csust.eyediagnosis.ai;

import cn.hutool.core.bean.BeanUtil;
import com.csust.eyediagnosis.ai.chatmemory.RedisChatMemoryStoreWithDb;
import com.csust.eyediagnosis.service.ChatHistoryService;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.memory.chat.MessageWindowChatMemory;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.chat.StreamingChatModel;
import dev.langchain4j.model.chat.request.ChatRequest;
import dev.langchain4j.model.openai.OpenAiChatRequestParameters;
import dev.langchain4j.model.openai.OpenAiStreamingChatModel;
import dev.langchain4j.service.AiServices;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * @ ClassName AiDiagnosisServiceFactory
 * @ Description 诊断ai服务工厂
 * @ Author 钰玟
 * @ Date 2025/9/19 下午2:03
 * Version 1.0
 **/
@Configuration
@Slf4j
public class AiDiagnosisServiceFactory {
    @Resource
    private OpenAiStreamingChatModel reasoningStreamingChatModelPrototype;
    @Resource
    private StreamingChatModel openAiStreamingChatModel;
    @Resource
    private ChatModel chatModel;
    @Resource
    private RedisChatMemoryStoreWithDb redisChatMemoryStoreDb;
    @Resource
    private ChatHistoryService chatHistoryService;

    /**
     * AI 服务实例缓存
     * 缓存策略：
     * - 最大缓存 1000 个实例
     * - 写入后 30 分钟过期
     * - 访问后 10 分钟过期
     */
    private final Cache<String, AiDiagnosisService> serviceCache = Caffeine.newBuilder()
            .maximumSize(1000)
            .expireAfterWrite(Duration.ofMinutes(30))
            .expireAfterAccess(Duration.ofMinutes(10))
            .removalListener((key, value, cause) -> {
                log.debug("AI 服务实例被移除，cacheKey: {}, 原因: {}", key, cause);
            })
            .build();

    /**
     * 通过缓存获取AI服务实例
     * @param sessionId 会话ID
     * @return AI服务实例
     */
    public AiDiagnosisService getAiCodeGeneratorService(Long sessionId, Boolean isThinking) {
        String cacheKey = buildCacheKey(sessionId);
        return serviceCache.get(cacheKey,key->createAiDiagnosisService(sessionId, isThinking));
    }

    /**
     * 创建AI服务实例
     * @param sessionId 会话ID
     * @return AI服务实例
     */
    public AiDiagnosisService createAiDiagnosisService(Long sessionId,Boolean isThinking) {
        //构建对话历史持久化容器
        MessageWindowChatMemory chatMemory = MessageWindowChatMemory
                .builder()
                .id(sessionId)
                .chatMemoryStore(redisChatMemoryStoreDb)
                .maxMessages(20)
                .build();

        chatHistoryService.loadChatHistoryToMemory(sessionId, chatMemory, 20);
        if(isThinking) {
            //推理模式
            return AiServices.builder(AiDiagnosisService.class)
                    .chatModel(chatModel)
                    .streamingChatModel(reasoningStreamingChatModelPrototype)
                    .chatMemory(chatMemory)
                    .build();
        }else{
            //普通模式
            return AiServices.builder(AiDiagnosisService.class)
                    .chatModel(chatModel)
                    .streamingChatModel(openAiStreamingChatModel)
                    .chatMemory(chatMemory)
                    .build();
        }
    }
    @Bean
    public AiDiagnosisService aiDiagnosisService(){
        return createAiDiagnosisService(0L, false);
    }

    /**
     * 构建缓存key
     * @param sessionId 会话ID
     * @return 缓存key
     */
    private String buildCacheKey(Long sessionId){
        return sessionId + "_" + System.currentTimeMillis();
    }
}
