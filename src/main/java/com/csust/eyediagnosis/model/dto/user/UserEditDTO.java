package com.csust.eyediagnosis.model.dto.user;

import lombok.Data;

import java.io.Serializable;

/**
 * @ClassNameUserUpdateDTO
 * @Description 修改传输对象
 * @Author钰玟
 * @Date2025/4/12 下午5:29
 * @Version 1.0
 **/
@Data
public class UserEditDTO implements Serializable {
    /**
     * id
     */
    private Long id;

    /**
     * 用户昵称
     */
    private String userName;

    /**
     * 用户头像
     */
    private String userAvatar;

    /**
     * 简介
     */
    private String userProfile;
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
