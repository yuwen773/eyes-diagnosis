package com.csust.eyediagnosis.model.dto.user;

import com.csust.eyediagnosis.common.PageRequest;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.io.Serializable;

/**
 * @ClassNameUserQueryDTO
 * @Description 查询传输对象
 * @Author钰玟
 * @Date2025/4/12 下午5:29
 * @Version 1.0
 **/
@EqualsAndHashCode(callSuper = true)
@Data
public class UserQueryDTO extends PageRequest implements Serializable {

    /**
     * id
     */
    private Long id;
    /**
     * 用户昵称
     */
    private String userName;

    /**
     * 账号
     */
    private String userAccount;

    /**
     * 简介
     */
    private String userProfile;

    /**
     * 用户角色：user/admin/ban
     */
    private String userRole;

    /**
     * 注册时间下界（含当天），格式 yyyy-MM-dd
     */
    private String startDate;

    /**
     * 注册时间上界（含当天），格式 yyyy-MM-dd
     */
    private String endDate;

    private static final long serialVersionUID = 1L;
}
