package com.csust.eyediagnosis.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean(name = "titleGenerationExecutor")
    public Executor titleGenerationExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("title-gen-");
        executor.initialize();
        return executor;
    }

    @Bean(name = "documentProcessingExecutor")
    public Executor documentProcessingExecutor(
            @Value("${document.executor.core-size:2}") int coreSize,
            @Value("${document.executor.max-size:4}") int maxSize,
            @Value("${document.executor.queue-capacity:16}") int queueCapacity) {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(coreSize);
        executor.setMaxPoolSize(maxSize);
        executor.setQueueCapacity(queueCapacity);
        executor.setThreadNamePrefix("doc-etl-");
        executor.initialize();
        return executor;
    }
}