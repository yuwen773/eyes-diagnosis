package com.csust.eyediagnosis.model.dto.news;

import com.csust.eyediagnosis.common.BatchIdsRequest;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.io.Serializable;

/**
 * 批量改发布状态的请求体：目标文章 id + 目标状态 + 审核意见（可空）。
 *
 * <p>状态取值与 {@code t_news.status} 同义：0 草稿 / 1 已发布 / 2 下架 / 3 待审核。
 * 每篇文章的迁移合法性由后端的状态迁移表逐条裁决。
 */
@EqualsAndHashCode(callSuper = true)
@Data
public class NewsBatchStatusDTO extends BatchIdsRequest implements Serializable {

    /**
     * 目标发布状态
     */
    private Integer status;

    /**
     * 审核意见 / 下架原因（转下架时会写进 offlineReason）
     */
    private String note;

    private static final long serialVersionUID = 1L;
}
