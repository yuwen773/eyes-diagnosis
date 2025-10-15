package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
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
}