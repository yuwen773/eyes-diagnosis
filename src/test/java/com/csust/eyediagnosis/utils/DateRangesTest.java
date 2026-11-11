package com.csust.eyediagnosis.utils;

import com.csust.eyediagnosis.exception.BusinessException;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 管理端筛选里的日期解析。
 *
 * <p>两个容易踩的坑：
 * <ol>
 *   <li>空串表示「不限」，不能被解析成 1970 年；</li>
 *   <li>终点必须含当天（23:59:59），否则「注册至 11 月 1 日」会把当天的记录漏掉；</li>
 *   <li>格式不对要抛业务错误，不能悄悄当成「不限」——那会让筛选看起来生效了，
 *       其实没筛。</li>
 * </ol>
 */
class DateRangesTest {

    @Test
    void 空串与null都不限() {
        assertNull(DateRanges.parseDay(null, false));
        assertNull(DateRanges.parseDay("", false));
        assertNull(DateRanges.parseDay("   ", true));
        assertNull(DateRanges.parseLocalDay("", false));
    }

    @Test
    void 起点是当天零点() {
        LocalDateTime expected = LocalDate.parse("2026-11-01").atStartOfDay();
        LocalDateTime actual = LocalDateTime.ofInstant(
                DateRanges.parseDay("2026-11-01", false).toInstant(),
                ZoneId.systemDefault());
        assertEquals(expected, actual);
    }

    @Test
    void 终点含当天() {
        LocalDateTime actual = LocalDateTime.ofInstant(
                DateRanges.end("2026-11-01").toInstant(),
                ZoneId.systemDefault());
        assertEquals(LocalDate.parse("2026-11-01"), actual.toLocalDate());
        assertTrue(actual.getHour() == 23, "终点应落在当天 23 点之后");
    }

    @Test
    void 格式不对抛业务错误() {
        BusinessException error = assertThrows(BusinessException.class,
                () -> DateRanges.parseDay("2026/11/01", false));
        assertTrue(error.getMessage().contains("yyyy-MM-dd"));
    }

    @Test
    void LocalDateTime形态与Date形态语义一致() {
        assertEquals(
                DateRanges.parseDay("2026-11-01", false).toInstant(),
                DateRanges.parseLocalDay("2026-11-01", false).atZone(ZoneId.systemDefault()).toInstant());
    }
}
