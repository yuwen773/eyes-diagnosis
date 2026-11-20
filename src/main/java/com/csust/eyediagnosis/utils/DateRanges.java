package com.csust.eyediagnosis.utils;

import cn.hutool.core.util.StrUtil;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.Date;

/**
 * 管理端的日期区间解析。
 *
 * <p>筛选条件里的日期一律用 {@code yyyy-MM-dd} 字符串，不用 Date：
 * Jackson 把 "2026-11-01" 解析成 Date 时按 UTC 解释，东八区会偏 8 小时，
 * 「11 月 1 日之后」的边界因此变得不可预期。这里显式按本地时区解释，
 * 起点取当天 00:00:00，终点取当天 23:59:59.999999999。
 */
public final class DateRanges {

    private DateRanges() {
    }

    /**
     * 解析一天。
     *
     * @param text    yyyy-MM-dd 字符串，空串返回 null（表示不限）
     * @param endOfDay true 取当天末尾，false 取当天开头
     * @return 对应的时刻
     */
    public static Date parseDay(String text, boolean endOfDay) {
        if (StrUtil.isBlank(text)) {
            return null;
        }
        try {
            LocalDate day = LocalDate.parse(text.trim());
            LocalDateTime point = endOfDay
                    ? day.plusDays(1).atStartOfDay().minusNanos(1)
                    : day.atStartOfDay();
            return Date.from(point.atZone(ZoneId.systemDefault()).toInstant());
        } catch (DateTimeParseException e) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "日期格式应为 yyyy-MM-dd");
        }
    }

    /**
     * 解析区间的起点。
     */
    public static Date start(String text) {
        return parseDay(text, false);
    }

    /**
     * 解析区间的终点（含当天）。
     */
    public static Date end(String text) {
        return parseDay(text, true);
    }

    /**
     * 解析一天的 LocalDateTime 形态。
     *
     * <p>知识文档表的时间列是 LocalDateTime（实体字段类型如此），
     * 这里给同一套语义一个 LocalDateTime 版本，避免把 Date 转来转去。
     *
     * @param text     yyyy-MM-dd 字符串，空串返回 null（表示不限）
     * @param endOfDay true 取当天末尾，false 取当天开头
     */
    public static LocalDateTime parseLocalDay(String text, boolean endOfDay) {
        if (StrUtil.isBlank(text)) {
            return null;
        }
        try {
            LocalDate day = LocalDate.parse(text.trim());
            return endOfDay
                    ? day.plusDays(1).atStartOfDay().minusNanos(1)
                    : day.atStartOfDay();
        } catch (DateTimeParseException e) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "日期格式应为 yyyy-MM-dd");
        }
    }
}
