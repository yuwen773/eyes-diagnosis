package com.csust.eyediagnosis.ai.config;

import dev.langchain4j.model.chat.StreamingChatModel;
import dev.langchain4j.model.openai.OpenAiChatRequestParameters;
import dev.langchain4j.model.openai.OpenAiStreamingChatModel;
import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.Map;

/**
 * @ ClassName ReasoningStreamChatModel
 * @ Description 推理模型
 * @ Author 钰玟
 * @ Date 2025/9/20 下午12:16
 * Version 1.0
 **/
@Configuration
@ConfigurationProperties(prefix = "langchain4j.open-ai.reasoning-streaming-chat-model")
@Data
public class ReasoningStreamingChatModelConfig {

    private String baseUrl;

    private String apiKey;

    private String modelName;

    private Integer maxTokens;

    private Double temperature;

    private Boolean returnThinking;

    private Boolean logRequests = false;

    private Boolean logResponses = false;

    /**
     * 推理流式模型
     */
    @Bean
    public StreamingChatModel reasoningStreamingChatModelPrototype() {
        Map<String, Object> customParameters = Map.of("enable_thinking", true);
        return OpenAiStreamingChatModel.builder()
                .defaultRequestParameters(OpenAiChatRequestParameters.builder()
                        .customParameters(customParameters)
                        .build())
                .apiKey(apiKey)
                .baseUrl(baseUrl)
                .modelName(modelName)
                .maxTokens(maxTokens)
                .returnThinking(returnThinking)
                .logRequests(logRequests)
                .logResponses(logResponses)
                .build();
    }
}
