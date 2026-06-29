package com.csust.eyediagnosis.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.module.SimpleModule;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.fasterxml.jackson.datatype.jsr310.deser.LocalDateTimeDeserializer;
import com.fasterxml.jackson.datatype.jsr310.ser.LocalDateTimeSerializer;
import org.springframework.boot.jackson.JsonComponent;
import org.springframework.context.annotation.Bean;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * @ClassName JsonConfig
 * @Description SpringMVC Json配置
 * 定义了一个 ObjectMapper Bean，用于配置 Jackson 的 JSON 或 XML 处理能力。在这个自定义的 ObjectMapper 实例中，
 * 您通过 SimpleModule 注册了一些自定义的序列化器，特别是将 Long 类型的值转为 String。
 * 这种做法在 JSON 序列化时会将 Long 转换为字符串，
 * 以避免潜在的精度损失（尤其在 JavaScript 中，Number 类型的精度限制）。
 * @Author钰玟
 * @Date2025/4/12 下午8:18
 * @Version 1.0
 **/
@JsonComponent
public class JsonConfig {

    private static final DateTimeFormatter DATE_TIME_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    /**
     * json转化器 long 转 String 避免精度丢失，LocalDateTime 序列化为字符串
     * @param builder
     * @return
     */
    @Bean
    public ObjectMapper jacksonObjectMapper(Jackson2ObjectMapperBuilder builder) {
        /**
         * 创建 ObjectMapper:
         * 通过 Jackson2ObjectMapperBuilder 创建一个 ObjectMapper 实例，指定 createXmlMapper(false) 表示不使用 XML 映射。
         */
        ObjectMapper objectMapper = builder.createXmlMapper(false).build();

        // 注册 JavaTimeModule，支持 LocalDateTime 序列化/反序列化
        JavaTimeModule javaTimeModule = new JavaTimeModule();
        // 自定义 LocalDateTime 序列化格式
        javaTimeModule.addSerializer(LocalDateTime.class, new LocalDateTimeSerializer(DATE_TIME_FORMATTER));
        javaTimeModule.addDeserializer(LocalDateTime.class, new LocalDateTimeDeserializer(DATE_TIME_FORMATTER));
        objectMapper.registerModule(javaTimeModule);

        /**
         * 使用 SimpleModule 创建了一些自定义序列化规则，这里特别是将 Long 和 long 类型序列化为 String，避免在 JSON 传输中出现精度问题。
         */
        SimpleModule simpleModule = new SimpleModule();
        /**
         * 通过 objectMapper.registerModule(simpleModule) 将自定义的序列化器模块注册到 ObjectMapper 中，使其在序列化过程中被使用。
         */
        simpleModule.addSerializer(Long.class, ToStringSerializer.instance);
        simpleModule.addSerializer(Long.TYPE, ToStringSerializer.instance);
        objectMapper.registerModule(simpleModule);

        return objectMapper;
    }
}
