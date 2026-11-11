package com.csust.eyediagnosis.model.dto.diagnosis;

import com.csust.eyediagnosis.common.PageRequest;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.io.Serializable;
import java.util.Date;

/**
 * @ClassNameNewsQueryDTO
 * @Description TODO
 * @Author钰玟
 * @Date2025/4/23 下午7:20
 * @Version 1.0
 **/
@EqualsAndHashCode(callSuper = true)
@Data
public class DiagnosisQueryDTO extends PageRequest implements Serializable {
    /**
     * 诊断id
     */
    private Long id;
    /**
     * 疾病名称
     */
    private String result;
    /**
     * 诊断时间
     */
    private Date DiagnosisTime;
    /**
     * 用户角色：user/admin/ban
     */
    private String userRole;
    /**
     * 用户的id
     */
    private Long userId;

    /**
     * 复诊流程状态：1 未复审 / 2 复审中 / 3 已复审
     */
    private Integer reexamineStatus;

    /**
     * 人工复核状态：PENDING_AI / AI_ONLY / AWAITING_REVIEW / REVIEWED / OVERRIDDEN
     */
    private String humanReviewStatus;

    /**
     * AI 是否拒识（true 只看拒识记录）
     */
    private Boolean aiRejected;

    /**
     * 是否需要人工复核（true = 人工复核状态为 AWAITING_REVIEW）
     */
    private Boolean requiresReview;

    /**
     * 判读时间下界（含当天），格式 yyyy-MM-dd
     */
    private String startDate;

    /**
     * 判读时间上界（含当天），格式 yyyy-MM-dd
     */
    private String endDate;

    private static final long serialVersionUID = 1L;
}
