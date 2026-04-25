package com.csust.eyediagnosis.agent.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.ai.chroma.vectorstore.ChromaApi;
import org.springframework.ai.chroma.vectorstore.ChromaVectorStore;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

@Configuration
public class VectorStoreConfig {

    @Value("${spring.ai.vectorstore.chroma.client.host:http://localhost}")
    private String host;

    @Value("${spring.ai.vectorstore.chroma.client.port:8000}")
    private int port;

    @Value("${spring.ai.vectorstore.chroma.collection-name:eye-diagnosis-knowledge}")
    private String collectionName;

    @Bean
    public RestClient.Builder builder() {
        return RestClient.builder().requestFactory(new SimpleClientHttpRequestFactory());
    }

    @Bean
    public ChromaApi chromaApi(RestClient.Builder restClientBuilder) {
        String chromaUrl = host + ":" + port;
        ObjectMapper objectMapper = new ObjectMapper();
        return new ChromaApi(chromaUrl, restClientBuilder, objectMapper);
    }

    @Bean
    public VectorStore chromaVectorStore(EmbeddingModel dashscopeEmbeddingModel, ChromaApi chromaApi) {
        return ChromaVectorStore.builder(chromaApi, dashscopeEmbeddingModel)
                .tenantName("eye-diagnosis-knowledge")
                .databaseName("eye-diagnosis-knowledge")
                .collectionName(collectionName)
                .initializeSchema(true)
                .initializeImmediately(true)
                .build();
    }
}
