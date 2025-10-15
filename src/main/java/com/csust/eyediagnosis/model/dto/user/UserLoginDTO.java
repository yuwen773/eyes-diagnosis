package com.csust.eyediagnosis.model.dto.user;

import lombok.Data;

import java.io.Serializable;

/**
 * @ClassNameUserLoginDTO
 * @Description 用户登录数据传输模型
 * @Author钰玟
 * @Date2025/4/12 下午4:23
 * @Version 1.0
 **/

@Data
public class UserLoginDTO implements Serializable {

    private static final long serialVersionUID = 3191241716373120793L;

    /**
     * 账号
     */
    private String userAccount;

    /**
     * 密码
     */
    private String userPassword;
}

