package com.csust.eyediagnosis.model.dto.user;

import lombok.Data;

import java.io.Serializable;

/**
 * @ClassNameUserRegisterDTO
 * @Description 用户注册时的数据模型
 * @Author钰玟
 * @Date2025/4/12 下午3:33
 * @Version 1.0
 **/

@Data
public class UserRegisterDTO implements Serializable {
    private static final long serialVersionUID = 3191241716373120793L;
    /**
     * 账号
     */
    private String userAccount;

    /**
     * 密码
     */
    private String userPassword;

    /**
     * 确认密码
     */
    private String checkPassword;
}

