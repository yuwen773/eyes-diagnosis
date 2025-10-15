package com.csust.eyediagnosis.ai.chatmemory;

import dev.langchain4j.community.store.memory.chat.redis.RedisChatMemoryStoreException;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.data.message.ChatMessageDeserializer;
import dev.langchain4j.data.message.ChatMessageSerializer;
import dev.langchain4j.internal.ValidationUtils;
import dev.langchain4j.store.memory.chat.ChatMemoryStore;
import redis.clients.jedis.DefaultJedisClientConfig;
import redis.clients.jedis.HostAndPort;
import redis.clients.jedis.JedisPooled;

import java.util.ArrayList;
import java.util.List;

/**
 * 根据 dev.langchain4j.community.store.memory.chat.redis.RedisChatMemoryStore.class 源码修改而来
 * 新增database的自定义
 */
// 自定义支持 Database 配置的 RedisChatMemoryStore
public class RedisChatMemoryStoreWithDb implements ChatMemoryStore {
    private final JedisPooled client;
    private final String keyPrefix;
    private final Long ttl;
    // 新增 database 参数的构造方法
    public RedisChatMemoryStoreWithDb(String host, Integer port, String user, String password, int database, String prefix, Long ttl) {
        // 校验必填参数
        String finalHost = ValidationUtils.ensureNotBlank(host, "host");
        int finalPort = ValidationUtils.ensureNotNull(port, "port");
        int finalDb = ValidationUtils.ensureNotNull(database, "database"); // 确保 Database 是正整数
        this.keyPrefix = ValidationUtils.ensureNotNull(prefix, "prefix");
        this.ttl = ValidationUtils.ensureNotNull(ttl, "ttl");

        // 1. 构建 JedisClientConfig（包含 Database 配置）
        DefaultJedisClientConfig.Builder clientConfigBuilder = DefaultJedisClientConfig.builder()
                .database(finalDb); // 关键：指定 Redis Database 索引

        // 2. 配置用户名密码（若有）
        if (user != null && !user.trim().isEmpty()) {
            String finalUser = ValidationUtils.ensureNotBlank(user, "user");
            String finalPassword = ValidationUtils.ensureNotBlank(password, "password");
            clientConfigBuilder.user(finalUser).password(finalPassword);
        }

        // 3. 实例化 JedisPooled（带 Database 配置）
        HostAndPort hostAndPort = new HostAndPort(finalHost, finalPort);
        this.client = new JedisPooled(hostAndPort, clientConfigBuilder.build());
    }

    // ------------------------------ 复用原 RedisChatMemoryStore 的核心逻辑 ------------------------------
    @Override
    public List<ChatMessage> getMessages(Object memoryId) {
        String json = this.client.get(this.toRedisKey(memoryId));
        return json == null ? new ArrayList<>() : ChatMessageDeserializer.messagesFromJson(json);
    }

    @Override
    public void updateMessages(Object memoryId, List<ChatMessage> messages) {
        String json = ChatMessageSerializer.messagesToJson(ValidationUtils.ensureNotEmpty(messages, "messages"));
        String key = this.toRedisKey(memoryId);
        String res;

        if (this.ttl > 0L) {
            res = this.client.setex(key, this.ttl, json);
        } else {
            res = this.client.set(key, json);
        }

        if (!"OK".equals(res)) {
            throw new RedisChatMemoryStoreException("Set memory error, msg=" + res);
        }
    }

    @Override
    public void deleteMessages(Object memoryId) {
        this.client.del(this.toRedisKey(memoryId));
    }

    private String toMemoryIdString(Object memoryId) {
        boolean isNullOrEmpty = memoryId == null || memoryId.toString().trim().isEmpty();
        if (isNullOrEmpty) {
            throw new IllegalArgumentException("memoryId cannot be null or empty");
        }
        return memoryId.toString();
    }

    private String toRedisKey(Object memoryId) {
        return this.keyPrefix + this.toMemoryIdString(memoryId);
    }

    // ------------------------------ 提供 Builder 便于配置 ------------------------------
    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private String host;
        private Integer port;
        private String user;
        private String password;
        private int database = 0; // 默认 Database 0
        private Long ttl = 0L;
        private String prefix = "";

        public Builder host(String host) {
            this.host = host;
            return this;
        }

        public Builder port(Integer port) {
            this.port = port;
            return this;
        }

        public Builder user(String user) {
            this.user = user;
            return this;
        }

        public Builder password(String password) {
            this.password = password;
            return this;
        }

        // 新增 Database 配置方法
        public Builder database(int database) {
            this.database = database;
            return this;
        }

        public Builder ttl(Long ttl) {
            this.ttl = ttl;
            return this;
        }

        public Builder prefix(String prefix) {
            this.prefix = prefix;
            return this;
        }

        public RedisChatMemoryStoreWithDb build() {
            return new RedisChatMemoryStoreWithDb(
                    this.host, this.port, this.user, this.password,
                    this.database, this.prefix, this.ttl
            );
        }
    }
}