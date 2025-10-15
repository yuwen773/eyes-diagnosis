package com.csust.eyediagnosis.model.vo.diagnosis;
import com.csust.eyediagnosis.model.entity.Diagnosis;
import com.csust.eyediagnosis.model.vo.user.UserVO;
import lombok.Data;
import org.springframework.beans.BeanUtils;

import java.io.Serializable;
import java.util.Date;

/**
 * @ClassNameDiagnosisVO
 * @Description diagnosis脱敏对象
 * @Author钰玟
 * @Date2025/4/21 下午8:47
 * @Version 1.0
 **/
@Data
public class DiagnosisVO implements Serializable{
    /**
     * id
     */
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
     * 创建用户信息
     */
    private UserVO user;

    private static final long serialVersionUID = 1L;


    /**
     * 封装类转对象
     */
    public static Diagnosis voToObj(DiagnosisManageVO diagnosisVO) {
        if (diagnosisVO == null) {
            return null;
        }
        Diagnosis diagnosis = new Diagnosis();
        BeanUtils.copyProperties(diagnosisVO, diagnosis);
        return diagnosis;
    }

    /**
     * 对象转封装类
     */
    public static DiagnosisManageVO objToVo(Diagnosis diagnosis) {
        if (diagnosis == null) {
            return null;
        }
        DiagnosisManageVO diagnosisVO = new DiagnosisManageVO();
        BeanUtils.copyProperties(diagnosis, diagnosisVO);
        return diagnosisVO;
    }

}


