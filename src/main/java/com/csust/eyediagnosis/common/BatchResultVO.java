package com.csust.eyediagnosis.common;

import lombok.Data;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;

/**
 * 批量操作的结果回执。
 *
 * <p>批量动作天然是「部分成功」的形态：10 条里 8 条删得掉、2 条因为权限或
 * 状态迁移非法删不掉。如果只回一个 boolean，管理员既不知道哪几条没成，
 * 也无法据此重试。这里把「请求了几条 / 成了几条 / 败了几条 / 败的是哪些」如实回传。
 */
@Data
public class BatchResultVO implements Serializable {

    /** 请求条数（去重后的目标数） */
    private int requested;

    /** 成功条数 */
    private int succeeded;

    /** 失败条数 */
    private int failed;

    /** 失败的目标 id（成功的不回传，避免回执比请求还长） */
    private List<String> failedIds = new ArrayList<>();

    /** 失败原因（人话，给管理员看） */
    private String message;

    public BatchResultVO() {
    }

    public BatchResultVO(int requested, int succeeded, List<String> failedIds, String message) {
        this.requested = requested;
        this.succeeded = succeeded;
        this.failed = failedIds.size();
        this.failedIds = failedIds;
        this.message = message;
    }

    private static final long serialVersionUID = 1L;
}
