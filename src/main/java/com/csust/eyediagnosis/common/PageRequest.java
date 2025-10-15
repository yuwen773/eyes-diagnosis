package com.csust.eyediagnosis.common;

import lombok.Data;

/**
 * @ClassNamePageRequest
 * @Description 分页请求类
 * @Author钰玟
 * @Date2025/4/10 下午8:50
 * @Version 1.0
 **/
@Data
public class PageRequest {

    /**
     * 当前页号
     */
    private int current = 1;

    /**
     * 页面大小
     */
    private int pageSize = 10;

    /**
     * 排序字段
     */
    private String sortField;

    /**
     * 排序顺序（默认降序）
     */
    private String sortOrder = "descend";
}
