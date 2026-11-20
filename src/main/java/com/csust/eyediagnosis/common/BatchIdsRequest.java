package com.csust.eyediagnosis.common;

import lombok.Data;

import java.io.Serializable;
import java.util.List;

/**
 * 批量操作请求体：一次提交一组主键。
 *
 * <p>管理端的「批量删除 / 批量改状态」都走这个信封。ids 允许为空或含重复项，
 * 由各业务服务去重与过滤——控制器只负责把请求形状定下来，不替业务做判断。
 *
 * <p>元素类型是 Long：雪花 id 在前端是字符串（超出 JS 安全整数），Jackson 会把
 * 数字字符串强制转成 Long，不丢精度。
 */
@Data
public class BatchIdsRequest implements Serializable {

    /**
     * 目标主键列表
     */
    private List<Long> ids;

    private static final long serialVersionUID = 1L;
}
