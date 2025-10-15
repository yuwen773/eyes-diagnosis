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
        return diagnosisResultVO;
    }
}



