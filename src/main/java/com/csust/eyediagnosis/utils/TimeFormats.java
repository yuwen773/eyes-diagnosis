package com.csust.eyediagnosis.utils;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Date;

/**
 * 对外时间格式的唯一入口。
 *
 * <p><b>契约：</b>API 上的时间一律是带时区偏移的 ISO-8601
 * （如 {@code 2026-11-08T18:20:00.000+08:00}）。数据库里存的是
 * {@code DATETIME} 墙钟，Connector/J 按连接串的 {@code serverTimezone}
 * 与 JVM 的 {@link Date} 实例互转；只要写入与读取用同一条连接配置，
 * 读回的 {@link Date} 就是正确的时间点。这里把时间点格式化成带偏移的
 * 字符串，前端按时间点解析后用浏览器本地时区展示。
 *
 * <p><b>历史数据：</b>旧配置 {@code spring.jackson.date-format} 没有配套
 * {@code time-zone}，Jackson 的 {@link java.util.Date} 默认按 UTC 输出，
 * 所以旧 API 里 {@code "2026-11-08 10:20:00"} 表示的是 UTC 时刻。前端
 * {@code parseApiDate} 据此把无偏移的历史字符串按 UTC 解析；这里不需要
 * 对数据库做任何加减时区。
 */
public final class TimeFormats {

    private static final DateTimeFormatter ISO_OFFSET =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSXXX");

    private TimeFormats() {
    }

    /** 时间点 → 带偏移的 ISO-8601；偏移取 JVM 默认时区（与 JDBC 会话一致）。 */
    public static String toIsoOffset(Date date) {
        if (date == null) {
            return null;
        }
        return toIsoOffset(date.toInstant());
    }

    public static String toIsoOffset(Instant instant) {
        if (instant == null) {
            return null;
        }
        return ISO_OFFSET.format(instant.atZone(ZoneId.systemDefault()));
    }

    public static String nowIsoOffset() {
        return toIsoOffset(Instant.now());
    }

    /** 导出等人类可读场景：本地墙钟，不带偏移。 */
    public static String toHumanLocal(Date date) {
        if (date == null) {
            return "";
        }
        return DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
                .format(date.toInstant().atZone(ZoneId.systemDefault()));
    }
}
