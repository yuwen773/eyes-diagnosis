package com.csust.eyediagnosis.service;

/**
 * 判读运行的状态仲裁：让「取消」在服务端有一个可验证的结果（#135）。
 *
 * <p>判读是同步接口，取消请求可能在推理中途、落库前后任意时刻到达。唯一可靠的
 * 办法是把「这次运行还算不算数」落库，并用条件更新决定胜负：
 * {@link #claim} 与 {@link #cancel} 都是 compare-and-set，谁先提交谁赢。
 */
public interface DiagnosisRunService {

    /** 取消的结果。 */
    enum CancelOutcome {
        /** 取消成功，本次判读不会落库，已上传的原图由调用方删除。 */
        CANCELLED,
        /** 结果已经生成。不静默删除医疗记录，前端如实告知。 */
        ALREADY_FINISHED,
        /** 没有这次运行（或不属于当前用户——两种情况不做区分，避免探测）。 */
        NOT_FOUND
    }

    /**
     * 登记一次运行（PENDING）。同一 runId 重复登记视为客户端重试：
     * 进行中或已结束都直接拒绝，避免同一次运行被落两次。
     */
    void begin(String runId, Long userId);

    /**
     * 在落库事务里占用这次运行（PENDING → DONE）。
     *
     * @return true 表示占用成功；false 表示取消已经赢了，调用方必须回滚并删对象
     */
    boolean claim(String runId);

    /** 占用成功后补上正式记录 id。 */
    void attachDiagnosis(String runId, Long diagnosisId);

    /** 取消一次仍在进行中的运行。 */
    CancelOutcome cancel(String runId, Long userId);

    /** 只读探测，用于在推理开始前省掉无意义的工作；判定胜负仍以 {@link #claim} 为准。 */
    boolean isCancelled(String runId);
}
