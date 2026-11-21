package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.util.Date;

/**
 * 一次判读运行的状态（取消与落库的仲裁点）。
 *
 * <p>只表达「这次运行还算不算数」，不存任何诊断结论——结论仍然只写在
 * {@link Diagnosis} 里。语义与状态机见
 * {@code src/main/resources/db/migration/V31__diagnosis_run_cancellation.sql}。
 */
@Data
@TableName("t_diagnosis_run")
public class DiagnosisRun {

    public static final String PENDING = "PENDING";
    public static final String DONE = "DONE";
    public static final String CANCELLED = "CANCELLED";

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    /** 客户端生成的运行标识；取消接口用它定位。 */
    private String runId;

    private Long userId;

    private String status;

    /** DONE 时指向 t_diagnosis.id。 */
    private Long diagnosisId;

    private Date createTime;

    private Date updateTime;
}
