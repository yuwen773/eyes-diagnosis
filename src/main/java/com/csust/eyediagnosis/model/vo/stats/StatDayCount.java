package com.csust.eyediagnosis.model.vo.stats;

import lombok.Data;

import java.io.Serializable;

/**
 * 统计聚合的「一天 + 计数」一格。
 */
@Data
public class StatDayCount implements Serializable {

    /** 日期（yyyy-MM-dd） */
    private String day;

    /** 当天的计数 */
    private long value;

    public StatDayCount() {
    }

    public StatDayCount(String day, long value) {
        this.day = day;
        this.value = value;
    }

    private static final long serialVersionUID = 1L;
}
