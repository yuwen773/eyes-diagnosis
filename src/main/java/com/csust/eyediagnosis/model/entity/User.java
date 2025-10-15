package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.io.Serializable;
import java.util.Date;

/**
 * 用户
 * @TableName t_user
 */
@TableName(value ="t_user")
@Data
public class User implements Serializable {
    private static final long serialVersionUID = 1L;
    /**
     * id (要指定主键恶略)默认为自增 AUTO / 修改为雪花算法 ASSIGN_ID
     */
    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    /**
     * 账号
     */
    private String userAccount;

    /**
     * 密码
     */
    private String userPassword;

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
     * 用户角色：user/admin/vip
     */
    private String userRole;

    /**
     * 编辑时间
     */
    private Date editTime;

    /**
     * 创建时间
     */
    private Date createTime;

    /**
     * 更新时间
     */
    private Date updateTime;



    /**
     * 是否删除(逻辑删除)
     */
    @TableLogic
    private Integer isDelete;

//    /**
//     * 性别  1为男，0为女
//     */
//    private int gender;
//    /**
//     * 手机号
//     */
//    private String phone;
//    /**
//     * 邮箱地址
//     */
//    private String email;


}