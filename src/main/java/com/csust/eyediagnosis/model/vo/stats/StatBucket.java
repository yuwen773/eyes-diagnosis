package com.csust.eyediagnosis.model.vo.stats;

import lombok.Data;

import java.io.Serializable;

/**
 * 统计聚合的「名称 + 计数」一格。
 *
 * <p>病种分布、复核状态分布、知识库状态分布都是这个形状：
 * 一个可读的名字和一个计数。名字是给人看的（病种名、状态标签），
 * 计数用等宽数字读。
 */
@Data
public class StatBucket implements Serializable {

    /** 名称（病种名 / 状态标签） */
    private String name;

    /** 计数 */
    private long value;

    public StatBucket() {
    }

    public StatBucket(String name, long value) {
        this.name = name;
        this.value = value;
    }

    private static final long serialVersionUID = 1L;
}
