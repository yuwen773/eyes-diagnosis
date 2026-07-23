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

    private String preprocessVersion;

    private String predictedLabel;

    private Double probability;

    private String description;

    private Integer reliabilityScore;

    private String topPredictions;

    private Date createTime;
}
