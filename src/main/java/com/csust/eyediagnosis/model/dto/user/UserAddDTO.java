package com.csust.eyediagnosis.model.dto.user;

import lombok.Data;

import java.io.Serializable;

/**
 * @ClassNameUserAddDTO
 * @Description 增加传输对象
 * @Author钰玟
 * @Date2025/4/12 下午5:28
 * @Version 1.0
 **/
@Data
public class UserAddDTO implements Serializable {
    /**
     * 用户昵称
     */
    private String userName;
    /**
     * 账号
     */
    private String userAccount;
    /**
     * 用户头像
     */
    private String userAvatar;
    /**
     * 用户简介
     */
    private String userProfile;
    /**
     * 用户角色 (user/admin)
     */
    private String userRole;
    private static final long serialVersionUID = 1L;
}
