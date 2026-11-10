package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.util.Date;

/**
 * 诊断审计（t_diagnosis_audit，V5 建表）。
 *
 * <p>此前该表从未被写入：recordHumanReview 是唯一的医疗结论变更入口，
 * 却没有审计轨迹。这里让复核结论与操作者一起落盘。
 */
@Data
@TableName("t_diagnosis_audit")
public class DiagnosisAudit {

    @TableId(type = IdType.AUTO)
    private Long id;

    /** 被复核的诊断 id */
    private Long diagnosisId;

    /** 操作者 id */
    private Long actorId;

    /** 操作者角色 */
    private String actorRole;

    /** 动作：HUMAN_REVIEW */
    private String action;

    /** 复核结论载荷（JSON） */
    private String payload;

    private Date createdTime;
}
