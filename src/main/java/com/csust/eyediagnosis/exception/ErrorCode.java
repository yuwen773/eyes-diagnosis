package com.csust.eyediagnosis.exception;

import lombok.Getter;

/**
 * &#064;ClassNameErrorCode
 * &#064;Description  错误枚举类
 * &#064;Author钰玟
 * &#064;Date  2025/4/10 下午8:50
 * &#064;Version  1.0
 **/
@Getter
public enum ErrorCode {

    SUCCESS(0,"ok"),
    PARAMS_ERROR(40000,"请求参数错误"),
    NOT_LOGIN_ERROR(40100,"未登录"),
    NO_AUTH_ERROR(40101,"无权限"),
    NOT_FOUND_ERROR(40400,"请求数据不存在"),
    FORBIDDEN_ERROR(40300,"禁止访问"),
    SYSTEM_ERROR(50000,"系统内部异常"),
    OPERATION_ERROR(50001,"操作失败"),
    /**
     * 影像存储失败（对象存储超时 / 鉴权 / 服务端异常）。
     *
     * 单独一个码，而不是复用 SYSTEM_ERROR：前端要能把「影像没存下来、
     * 本次判读未归档、可以重试」和笼统的「服务没响应」分开说。
     */
    STORAGE_ERROR(50002,"影像存储失败"),

    DIAGNOSIS_REJECTED_QUALITY(40010,"图片质量不合格"),
    DIAGNOSIS_REJECTED_OOD(40011,"图像分布外"),
    DIAGNOSIS_NEEDS_REVIEW(40012,"诊断结果需人工复核"),
    /**
     * 用户在判读进行中取消了本次运行。
     *
     * 单独一个码而不是复用一个笼统的错误：前端要能把它识别成「按你的要求停下了」，
     * 既不当失败提示，也不重试。服务端保证此时没有落库、没有留下原图。
     */
    DIAGNOSIS_CANCELLED(40013,"判读已取消")
    ;
    /**
     * 状态码
     */
    private final int code;

    /**
     * 返回信息
     */
    private final String message;

    ErrorCode(int code, String message) {
        this.code = code;
        this.message = message;
    }
}
