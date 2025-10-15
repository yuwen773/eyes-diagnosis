package com.csust.eyediagnosis.model.dto.diagnosis;

import lombok.Data;

import java.io.Serializable;

/**
 * @ClassNameRediagnosisDTO
 * @Description TODO
 * @Author钰玟
 * @Date2025/6/16 下午6:59
 * @Version 1.0
 **/
@Data
public class RediagnosisDTO implements Serializable {
    /**
     * 用户id
     */
    private long userId;
    /**
     * 诊断id
     */
    private long diagnosisId;
}
