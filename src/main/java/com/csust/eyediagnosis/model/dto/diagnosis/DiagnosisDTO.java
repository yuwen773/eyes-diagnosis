package com.csust.eyediagnosis.model.dto.diagnosis;

import lombok.Data;

import java.io.Serializable;

/**
 * @ClassNameDiagnosisDTO
 * @Description TODO
 * @Author钰玟
 * @Date2025/4/27 下午7:16
 * @Version 1.0
 **/
@Data
public class DiagnosisDTO implements Serializable {
    /**
     * 诊断图片的url
     */
    private String imageUrl;

    private static final long serialVersionUID = 1L;
}
