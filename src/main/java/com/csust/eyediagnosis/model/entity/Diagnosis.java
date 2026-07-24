package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.util.Date;

/**
 * 诊断
 * @TableName t_diagnosis
 */
@TableName(value ="t_diagnosis")
@Data
public class Diagnosis {
    /**
     * id
     */
    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    /**
     * 图片 url
     */
    private String url;

    /**
     * 创建用户 id
     */
    private Long userId;

    /**
     * 诊断结果
     */
    private String result;

    /**
     * 诊断置信度
     */
    private Double confidence;

    /**
     * 诊断可能性
     */
    private Double probability;

    /**
     * 诊断建议
     */
    private String recommendations;

    /**
     * 诊断详情
     */
    private String details;

    /**
     * 严重程度
     */
    private String severity;
    /**
     * 复审状态 1, 未复审 2, 复审中 3, 已复审
     */
    private int reexamineStatus;

    /**
     * 图片体积
     */
    private Long picSize;

    /**
     * 图片宽度
     */
    private Integer picWidth;

    /**
     * 图片高度
     */
    private Integer picHeight;

    /**
     * 图片宽高比例
     */
    private Double picScale;

    /**
     * 图片格式
     */
    private String picFormat;

    /**
     * 创建时间
     */
    private Date createTime;

    /**
     * 是否删除
     */
    @TableLogic
    private Integer isDelete;

    /** AI 是否拒识（quality/OOD/low_confidence） */
    private Boolean aiRejected;
    /** 拒识原因: QUALITY_FAIL / OOD / LOW_CONFIDENCE / NOT_ASSESSED / MODEL_NOT_LOADED */
    private String abstainReason;
    /** 模型版本 */
    private String modelVersion;
    /** 权重 SHA-256 */
    private String weightSha256;
    /** 人工复审状态: PENDING_AI / AI_ONLY / AWAITING_REVIEW / REVIEWED / OVERRIDDEN */
    private String humanReviewStatus;
    /** 人工复审人 id */
    private Long humanReviewerId;
    /** 人工复审时间 */
    private Date humanReviewedAt;
    /** 人工备注 */
    private String humanReviewNote;
    /** 人工结论 */
    private String humanResult;
    /** 人工严重程度 */
    private String humanSeverity;
    /** 人工建议 */
    private String humanRecommendations;
}