package com.csust.eyediagnosis.model.dto.diagnosis;

import com.csust.eyediagnosis.common.PageRequest;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.io.Serializable;
import java.util.Date;

/**
 * @ClassNameNewsQueryDTO
 * @Description TODO
 * @Author钰玟
 * @Date2025/4/23 下午7:20
 * @Version 1.0
 **/
@EqualsAndHashCode(callSuper = true)
@Data
public class DiagnosisQueryDTO extends PageRequest implements Serializable {
    /**
     * 诊断id
     */
    private Long id;
    /**
     * 疾病名称
     */
    private String result;
    /**
     * 诊断时间
     */
    private Date DiagnosisTime;
    /**
     * 用户角色：user/admin/ban
     */
    private String userRole;
    /**
     * 用户的id
     */
    private Long userId;

    private static final long serialVersionUID = 1L;
}
