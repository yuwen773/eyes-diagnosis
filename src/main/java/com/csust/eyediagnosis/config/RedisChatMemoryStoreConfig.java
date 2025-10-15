package com.csust.eyediagnosis.config;

import com.csust.eyediagnosis.ai.chatmemory.RedisChatMemoryStoreWithDb;
import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Redis会话记忆 配置
 */
@Configuration
@ConfigurationProperties(prefix = "spring.data.redis")
@Data
public class RedisChatMemoryStoreConfig {

    private String host;

    private int port;

    private int database;

    private String password;

    private long ttl;

    @Bean
    public RedisChatMemoryStoreWithDb redisChatMemoryStoreDb() {
        return RedisChatMemoryStoreWithDb.builder()
                .host(host)
                .port(port)
                .password(password)
                .database(database)
                .ttl(ttl)
                .build();
    }
}

