package com.csust.eyediagnosis.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Date;
import java.util.Map;
import java.util.TimeZone;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * API 时间契约的出口测试。
 *
 * <p>旧配置 {@code spring.jackson.date-format} 没有配套 {@code time-zone} 时，
 * Jackson 的 {@link Date} 会输出成 UTC 墙钟且不带偏移——浏览器只能当本地时间
 * 读，于是北京时间 18:20 显示成 10:20。这里验证自定义模块序列化器压过
 * builder 的 dateFormat，并且始终带偏移。
 */
class ApiDateSerializerTest {

    private TimeZone original;

    @BeforeEach
    void rememberZone() {
        original = TimeZone.getDefault();
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"));
    }

    @AfterEach
    void restoreZone() {
        TimeZone.setDefault(original);
    }

    private static final Date BEIJING_1820 = Date.from(Instant.parse("2026-11-08T10:20:00Z"));

    private ObjectMapper mapper(Jackson2ObjectMapperBuilder builder) {
        return new JsonConfig().jacksonObjectMapper(builder);
    }

    @Test
    void dateIsSerializedWithOffset() throws Exception {
        ObjectMapper objectMapper = mapper(new Jackson2ObjectMapperBuilder());
        assertEquals("\"2026-11-08T18:20:00.000+08:00\"",
                objectMapper.writeValueAsString(BEIJING_1820));
    }

    /**
     * 实体里的 {@code createTime} 是 LocalDateTime（服务器本地墙钟）。
     * 它必须和 Date 走同一条出口契约，否则前端按 UTC 解析会整体偏 8 小时。
     */
    @Test
    void localDateTimeIsSerializedWithOffset() throws Exception {
        String json = mapper(new Jackson2ObjectMapperBuilder())
                .writeValueAsString(java.time.LocalDateTime.of(2026, 11, 8, 18, 20, 0));
        assertEquals("\"2026-11-08T18:20:00.000+08:00\"", json);
    }

    @Test
    void moduleSerializerBeatsLegacyDateFormat() throws Exception {
        // 模拟历史 profile 里遗留的 spring.jackson.date-format
        Jackson2ObjectMapperBuilder builder = new Jackson2ObjectMapperBuilder();
        builder.dateFormat(new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss"));
        String json = mapper(builder).writeValueAsString(BEIJING_1820);

        assertTrue(json.contains("+08:00"), "不应退回无偏移的墙钟: " + json);
        assertFalse(json.contains("10:20:00"), "不应按 UTC 输出墙钟: " + json);
    }

    @Test
    void sqlTimestampAndNestedDatesFollowTheSameContract() throws Exception {
        ObjectMapper objectMapper = mapper(new Jackson2ObjectMapperBuilder());
        String json = objectMapper.writeValueAsString(Map.of(
                "createdTime", new Timestamp(BEIJING_1820.getTime()),
                "updatedTime", BEIJING_1820));
        // 两个字段都是同一个瞬间；具体时分由 JVM 时区决定，这里只锚偏移。
        assertEquals(2, json.split("\\+08:00", -1).length - 1, json);
    }

    @Test
    void nullDateStaysNull() throws Exception {
        ObjectMapper objectMapper = mapper(new Jackson2ObjectMapperBuilder());
        assertEquals("{\"createdTime\":null}",
                objectMapper.writeValueAsString(java.util.Collections.singletonMap("createdTime", null)));
    }
}
