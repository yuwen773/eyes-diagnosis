package com.csust.eyediagnosis.model.dto.diagnosis;

import lombok.Data;

import java.io.Serializable;
import java.util.Date;

/**
 * @ClassNameDiagnosisResultVO
 * @Description 人工复诊
 * @Author钰玟
 * @Date2025/4/27 下午8:17
 * @Version 1.0
 **/
@Data
public class DiagnosisResultDTO implements Serializable {
    /**
     * id
     */
    private Long id;

    /**
     * 图片 url
     */
    private String url;

    /**
     * 诊断结果
     */
    private String result;
    /**
     * 可靠性
     */
    private Double probability;
    /**
     * 诊断置信度
     */
    private Double confidence;

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
     * 创建时间
     */
    private Date createTime;

    /**
     * 其他疾病
     */
//    private List<Disease> otherDisease;

    private static final long serialVersionUID = 1L;
}



