package com.csust.eyediagnosis.agent.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.util.List;

/**
 * 眼科图像分析结果 — AI 多模态模型对眼科图片的结构化理解
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EyeAnalysisResult implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 图片内容的一句话医学描述
     */
    private String description;

    /**
     * 图片类型（眼底照片、验光单、OCT影像等）
     */
    private String imageType;

    /**
     * 关键特征列表
     */
    private List<String> keyFeatures;

    /**
     * 异常区域或可疑病变描述
     */
    private List<String> abnormalities;

    /**
     * 英文医学关键词（可用于医学知识库搜索）
     */
    private String medicalKeywords;

    /**
     * 紧急程度：normal（正常）| attention（需关注）| urgent（需尽快就医）
     */
    private String urgency;

    /**
     * 初步建议
     */
    private String recommendations;
}
