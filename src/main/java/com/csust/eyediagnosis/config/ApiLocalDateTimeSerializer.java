package com.csust.eyediagnosis.config;

import com.csust.eyediagnosis.utils.TimeFormats;
import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.SerializerProvider;

import java.io.IOException;
import java.time.LocalDateTime;

/**
 * {@link LocalDateTime} → 带偏移的 ISO-8601。
 *
 * <p>实体里的 {@code createTime} 是 {@code LocalDateTime}，值本身就是
 * 「服务器本地墙钟」。旧配置把它写成 {@code yyyy-MM-dd HH:mm:ss}，
 * 前端按 UTC 解析后整体偏 8 小时；这里补上偏移，与 {@link ApiDateSerializer}
 * 使用同一套契约，HTTP 上不再出现无时区的墙钟字符串。
 *
 * <p>反序列化仍接受 {@code yyyy-MM-dd HH:mm:ss}（请求体里手写的本地时间），
 * 本类只改输出方向。
 */
public class ApiLocalDateTimeSerializer extends JsonSerializer<LocalDateTime> {

    @Override
    public void serialize(LocalDateTime value, JsonGenerator gen, SerializerProvider serializers)
            throws IOException {
        if (value == null) {
            gen.writeNull();
            return;
        }
        gen.writeString(TimeFormats.toIsoOffset(value));
    }
}
