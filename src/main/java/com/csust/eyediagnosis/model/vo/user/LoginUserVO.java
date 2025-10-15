package com.csust.eyediagnosis.model.vo.user;

import lombok.Data;

import java.io.Serializable;
import java.util.Date;

/**
 * @ClassNameUserLoginVO
 * @Description TODO
 * @Author钰玟
 * @Date2025/4/12 下午4:26
 * @Version 1.0
 **/

@Data
public class LoginUserVO implements Serializable {

    /**
     * 用户 id
     */
    private Long id;

    /**
     * 账号
     */
    private String userAccount;

    /**
     * 用户昵称
     */
    private String userName;

    /**
     * 用户头像
     */
    private String userAvatar;

    /**
     * 用户简介
     */
    private String userProfile;

    /**
     * 用户角色：user/admin
     */
    private String userRole;

    /**
     * 创建时间
     */
    private Date createTime;

    /**
     * 更新时间
     */
    private Date updateTime;
    /**
     * 性别
     */
    private int gender;
    /**
     * 手机号
     */
    private String phone;
    /**
     * 邮箱地址
     */
    private String email;

    private static final long serialVersionUID = 1L;
}

