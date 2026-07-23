package com.csust.eyediagnosis.agent.queue;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AgentQueueConfig {

    @Bean(destroyMethod = "shutdown")
    public SessionMessageQueue sessionMessageQueue(
            @Value("${agent.queue.parallelism:8}") int parallelism) {
        return new SessionMessageQueue(parallelism);
    }
}