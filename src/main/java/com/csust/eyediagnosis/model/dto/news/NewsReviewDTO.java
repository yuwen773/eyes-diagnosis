package com.csust.eyediagnosis.model.dto.news;

import lombok.Data;

import java.io.Serializable;

/**
 * 新闻审核请求：目标状态 + 审核意见/下架原因。
 * 与 /news/edit 分开，让「改内容」与「改发布状态」成为两件事。
 */
@Data
public class NewsReviewDTO implements Serializable {

    /** 新闻 id */
    private Long id;

    /** 目标状态，取值见 {@link com.csust.eyediagnosis.constant.NewsStatus} */
    private Integer status;

    /** 审核意见；下架时兼作下架原因 */
    private String note;

    private static final long serialVersionUID = 1L;
}
