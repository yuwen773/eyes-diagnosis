package com.csust.eyediagnosis.exception;

/**
 * @ClassNameThrowUtils
 * @Description 断言异常类
 * @Author钰玟
 * @Date2025/4/10 下午8:51
 * @Version 1.0
 **/

public class ThrowUtils {


    /**
     * 条件成立则抛出异常
     * @param condition 条件
     * @param runtimeException 异常
     */
    public static void throwIf(boolean condition,RuntimeException runtimeException) {
        if (condition) {
            throw runtimeException;
        }
    }
    /**
     * 条件成立则抛出异常
     * @param condition  条件
     * @param errorCode 错误枚举类
     */
    public static void throwIf(boolean condition,ErrorCode errorCode) {
        if (condition) {
            throwIf(condition,new BusinessException(errorCode));
        }
    }

    /**
     * 条件成立则抛出异常
     * @param condition 条件
     * @param errorCode 错误码
     * @param message 错误信息
     */
    public static void throwIf(boolean condition,ErrorCode errorCode,String message) {
        if (condition) {
            throwIf(condition,new BusinessException(errorCode,message));
        }
    }
}
