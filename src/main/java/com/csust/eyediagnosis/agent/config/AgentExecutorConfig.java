package com.csust.eyediagnosis.agent.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

@Configuration
public class AgentExecutorConfig {

    @Bean(name = "mcpExecutor", destroyMethod = "shutdown")
    public ThreadPoolExecutor mcpExecutor(
            @Value("${mcp.executor.core-size:4}") int coreSize,
            @Value("${mcp.executor.max-size:16}") int maxSize,
            @Value("${mcp.executor.queue-capacity:64}") int queueCapacity,
            @Value("${mcp.executor.timeout-seconds:60}") long timeoutSeconds) {
        return buildMcpExecutor(coreSize, maxSize, queueCapacity, (int) timeoutSeconds);
    }

    public static ThreadPoolExecutor buildMcpExecutor(int coreSize, int maxSize, int queueCapacity, int timeoutSeconds) {
        ThreadPoolExecutor executor = new ThreadPoolExecutor(
                coreSize, maxSize,
                timeoutSeconds, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(queueCapacity),
                new ThreadPoolExecutor.AbortPolicy());
        executor.allowCoreThreadTimeOut(true);
        return executor;
    }
}
