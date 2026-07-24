package com.csust.eyediagnosis.model.vo.diagnosis;

import com.csust.eyediagnosis.model.entity.Diagnosis;
import lombok.Data;
import org.springframework.beans.BeanUtils;

import java.io.Serializable;
import java.util.Date;
import java.util.List;

/**
 * @ClassNameDiagnosisResultVO
 * @Description 诊断结果展示
 * @Author钰玟
 * @Date2025/4/27 下午8:17
 * @Version 1.0
 **/
@Data
public class DiagnosisResultVO  implements Serializable {
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
    private List<Disease> otherDisease;

    /** AI 是否拒识 */
    private Boolean aiRejected;
    /** 拒识原因 */
    private String abstainReason;
    /** 模型版本 */
    private String modelVersion;
    /** 权重 SHA-256 */
    private String weightSha256;
    /** 人工复审状态 */
    private String humanReviewStatus;
    /** 人工结论 */
    private String humanResult;
    /** 人工严重程度 */
    private String humanSeverity;
    /** 人工建议 */
    private String humanRecommendations;
    /** 人工备注 */
    private String humanReviewNote;
    /** 医学免责声明文本 */
    private String disclaimer;
    /** 是否需要人工复核 */
    private Boolean requiresReview;
    /** 图像质量分数 */
    private Integer qualityScore;

    private static final long serialVersionUID = 1L;
    /**
     * 封装类转对象
     */
    public static Diagnosis voToObj(DiagnosisResultVO diagnosisResultVO) {
        if (diagnosisResultVO == null) {
            return null;
        }
        Diagnosis diagnosis = new Diagnosis();
        BeanUtils.copyProperties(diagnosisResultVO, diagnosis);
        return diagnosis;
    }

    /**
     * 对象转封装类
     */
    public static DiagnosisResultVO objToVo(Diagnosis diagnosis) {
        if (diagnosis == null) {
            return null;
        }
        DiagnosisResultVO diagnosisResultVO = new DiagnosisResultVO();
        BeanUtils.copyProperties(diagnosis, diagnosisResultVO);
        diagnosisResultVO.setRequiresReview("AWAITING_REVIEW".equals(diagnosis.getHumanReviewStatus()));
        if (Boolean.TRUE.equals(diagnosis.getAiRejected())) {
            diagnosisResultVO.clearAiConclusion();
        }
        return diagnosisResultVO;
    }

    public void clearAiConclusion() {
        result = null;
        probability = null;
        confidence = null;
        recommendations = null;
        details = null;
        severity = null;
        otherDisease = null;
    }
}



