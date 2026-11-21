package com.csust.eyediagnosis.model.vo.diagnosis;

import lombok.Data;

/**
 * 取消判读的回执。
 *
 * <p>取消是一个可能「来不及」的动作：判读是同步接口，用户点取消时结果可能已经生成。
 * 回执把实际发生了什么说清楚，前端据此决定是「已取消」还是「结果已生成，无法取消」，
 * 而不是一律当作成功。
 */
@Data
public class DiagnosisCancelVO {

    private String runId;

    /** CANCELLED / ALREADY_FINISHED / NOT_FOUND，取值同 {@code DiagnosisRunService.CancelOutcome}。 */
    private String outcome;

    public static DiagnosisCancelVO of(String runId, String outcome) {
        DiagnosisCancelVO vo = new DiagnosisCancelVO();
        vo.setRunId(runId);
        vo.setOutcome(outcome);
        return vo;
    }
}
