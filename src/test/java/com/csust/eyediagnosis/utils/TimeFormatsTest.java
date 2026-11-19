package com.csust.eyediagnosis.utils;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Date;
import java.util.TimeZone;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 时间格式化契约：API 上的时间一律带偏移，同一个时间点在上海与 UTC 输出
 * 不同的墙钟、相同的瞬间。
 */
class TimeFormatsTest {

    private TimeZone original;

    @BeforeEach
    void rememberZone() {
        original = TimeZone.getDefault();
    }

    @AfterEach
    void restoreZone() {
        TimeZone.setDefault(original);
    }

    /** 2026-11-08 10:20 UTC，也就是北京时间的 18:20。 */
    private static final Instant BEIJING_1820 = Instant.parse("2026-11-08T10:20:00Z");

    @Test
    void shanghaiWallClockMatchesTheInstant() {
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"));
        assertEquals("2026-11-08T18:20:00.000+08:00", TimeFormats.toIsoOffset(BEIJING_1820));
        assertEquals("2026-11-08T18:20:00.000+08:00",
                TimeFormats.toIsoOffset(Date.from(BEIJING_1820)));
    }

    @Test
    void utcOffsetIsRenderedAsZ() {
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
        assertEquals("2026-11-08T10:20:00.000Z", TimeFormats.toIsoOffset(BEIJING_1820));
    }

    @Test
    void outputAlwaysCarriesAnOffset() {
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"));
        String iso = TimeFormats.toIsoOffset(BEIJING_1820);
        assertTrue(iso.endsWith("+08:00") || iso.endsWith("Z"), "缺少时区偏移: " + iso);
        // 能被标准解析器还原成同一个瞬间——加 8 小时之类的“修补”会在这里露馅。
        assertEquals(BEIJING_1820, Instant.parse(iso));
    }

    @Test
    void nowIsAnOffsetBearingInstant() {
        String now = TimeFormats.nowIsoOffset();
        assertTrue(now.endsWith("+08:00") || now.endsWith("Z") || now.matches(".*[+-]\\d{2}:\\d{2}$"),
                "缺少时区偏移: " + now);
        assertTrue(Math.abs(Instant.parse(now).toEpochMilli() - System.currentTimeMillis()) < 60_000);
    }

    @Test
    void nullStaysNull() {
        assertNull(TimeFormats.toIsoOffset((Date) null));
        assertNull(TimeFormats.toIsoOffset((Instant) null));
        assertEquals("", TimeFormats.toHumanLocal(null));
    }

    @Test
    void humanLocalUsesLocalWallClock() {
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"));
        assertEquals("2026-11-08 18:20:00", TimeFormats.toHumanLocal(Date.from(BEIJING_1820)));
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
        assertEquals("2026-11-08 10:20:00", TimeFormats.toHumanLocal(Date.from(BEIJING_1820)));
    }
}
