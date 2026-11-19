package com.csust.eyediagnosis.agent.queue;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

@Configuration
public class AgentQueueConfig {

    @Bean(destroyMethod = "shutdown")
    public SessionMessageQueue sessionMessageQueue(
            @Value("${agent.queue.parallelism:8}") int parallelism,
            @Value("${agent.queue.await-timeout-ms:15000}") long awaitTimeoutMs) {
        return new SessionMessageQueue(parallelism, Duration.ofMillis(awaitTimeoutMs));
    }
}