package com.csust.eyediagnosis.model.dto.diagnosis;

import lombok.Data;

import java.io.Serializable;

/**
 * @ClassNameDiagnosisDTO
 * @Description TODO
 * @Author钰玟
 * @Date2025/4/21 下午8:52
 * @Version 1.0
 **/
@Data
public class DiagnosisUploadDTO implements Serializable {
    /**
     * 图片 id（用于修改）
     */
    private Long id;

    private static final long serialVersionUID = 1L;
}
