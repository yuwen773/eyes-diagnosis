package com.csust.eyediagnosis.upload.state;

import java.util.List;

/**
 * 上传任务状态。
 *
 * <p>{@code code} 是写入 {@code t_upload_task.status} 的整数值，务必显式声明：
 * 历史实现用 {@code ordinal() + 1} 推导，改动枚举顺序会静默改变库里的状态含义，
 * 而 {@code UploadTaskMapper.xml} 里的状态过滤是按数值写死的。
 */
public enum UploadStatus {

    /** 正在上传，任务行尚未落库。 */
    UPLOADING(1),
    /** 上传成功，任务行已落库，对象仍在 COS。 */
    PERSISTED(2),
    /** 上传失败。 */
    FAILED(3),
    /** 已被对话消息引用并落库。 */
    COMPLETED(4),
    /** 用户已删除，COS 对象应被清理。 */
    DELETED(5);

    private final int code;

    UploadStatus(int code) {
        this.code = code;
    }

    public int getCode() {
        return code;
    }

    /**
     * @return 与给定库值对应的状态；库中出现未知值时返回 {@code null}。
     */
    public static UploadStatus fromCode(Integer code) {
        if (code == null) {
            return null;
        }
        for (UploadStatus status : values()) {
            if (status.code == code) {
                return status;
            }
        }
        return null;
    }

    /**
     * "仍然有效"的状态集合：这些状态对应的 COS 对象必须保留。
     *
     * <p>FAILED 与 DELETED 不在其中——它们表示对象已失效，可以被补偿任务清理。
     * 补偿对账的 SQL 过滤由此列表驱动，状态语义只在枚举里维护一份。
     */
    public static List<Integer> activeCodes() {
        return List.of(UPLOADING.code, PERSISTED.code, COMPLETED.code);
    }
}
