package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.util.Date;

@Data
@TableName("t_inference_cache")
public class InferenceCache {

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    private String imageHash;

    private String modelVersion;

    private String weightSha256;

    private String preprocessVersion;

    private String predictedLabel;

    private Double probability;

    private Double calibratedProbability;

    private String description;

    private Integer reliabilityScore;

    private String topPredictions;

    private Integer qualityScore;

    private String qualityReasons;

    private Boolean isOod;

    private Double oodScore;

    private Boolean rejected;

    private String abstainReason;

    private Boolean requiresReview;

    private Date createTime;
}
