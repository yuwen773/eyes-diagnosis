package com.csust.eyediagnosis.model.vo.stats;

import lombok.Data;

import java.io.Serializable;

/**
 * 统计聚合的「一天 + 维度 + 计数」一格（按病种拆开的日趋势）。
 */
@Data
public class StatDayNameCount implements Serializable {

    /** 日期（yyyy-MM-dd） */
    private String day;

    /** 维度值（病种名） */
    private String name;

    /** 计数 */
    private long value;

    public StatDayNameCount() {
    }

    public StatDayNameCount(String day, String name, long value) {
        this.day = day;
        this.name = name;
        this.value = value;
    }

    private static final long serialVersionUID = 1L;
}
