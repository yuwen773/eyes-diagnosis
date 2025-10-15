package com.csust.eyediagnosis.exception;

import lombok.Getter;

/**
 * @ClassNameBusinessException
 * @Description 业务异常类
 * @Author钰玟
 * @Date2025/4/10 下午8:50
 * @Version 1.0
 **/
@Getter
public class BusinessException extends RuntimeException {
    /**
     * 错误码
     */
    private final int code;

    public BusinessException(String message, int code) {
        super(message);
        this.code = code;
    }
    public BusinessException(ErrorCode errorCode) {
        super(errorCode.getMessage());
        this.code = errorCode.getCode();
    }
    public BusinessException(ErrorCode errorCode, String message) {
        super(message);
        this.code = errorCode.getCode();
    }
}
