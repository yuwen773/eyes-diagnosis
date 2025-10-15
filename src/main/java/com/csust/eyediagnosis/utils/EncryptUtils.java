package com.csust.eyediagnosis.utils;

import org.springframework.util.DigestUtils;

/**
 * @ClassNamejiami
 * @Description TODO
 * @Author钰玟
 * @Date2025/4/12 下午4:07
 * @Version 1.0
 **/

public class EncryptUtils {
    // 盐值 混淆密码
    private static final String  SALT = "yuwen";
    public static String getEncryptPassWord(String password) {
        return DigestUtils.md5DigestAsHex((SALT+password).getBytes());
    }
}
