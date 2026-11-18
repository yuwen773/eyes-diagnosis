package com.csust.eyediagnosis.config;

import com.csust.eyediagnosis.utils.TimeFormats;
import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.SerializerProvider;

import java.io.IOException;
import java.util.Date;

/**
 * {@link java.util.Date} → 带偏移的 ISO-8601。
 *
 * <p>取代旧的 {@code spring.jackson.date-format: yyyy-MM-dd HH:mm:ss}：那条
 * 配置没有 time-zone，Jackson 默认按 UTC 格式化，输出的字符串既不带偏移、
 * 又是 UTC 墙钟，浏览器按本地时间解析后整体早 8 小时。这里显式写出偏移，
 * 「时间点」在传输层不再有歧义。
 *
 * <p>MyBatis 把 {@code DATETIME} 读成 {@link java.sql.Timestamp}（{@link Date}
 * 的子类），Jackson 按运行时类型选序列化器，所以三个类型都要登记。
 */
public class ApiDateSerializer extends JsonSerializer<Date> {

    @Override
    public void serialize(Date value, JsonGenerator gen, SerializerProvider serializers)
            throws IOException {
        if (value == null) {
            gen.writeNull();
            return;
        }
        gen.writeString(TimeFormats.toIsoOffset(value));
    }
}
