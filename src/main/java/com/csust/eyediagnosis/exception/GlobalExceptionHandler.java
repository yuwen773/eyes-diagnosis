package com.csust.eyediagnosis.exception;

import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import io.swagger.v3.oas.annotations.Hidden;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * @ClassNameGlobalExceptionHandlder
 * @Description 全局异常处理器
 * @Author钰玟
 * @Date2025/4/10 下午8:51
 * @Version 1.0
 **/
@RestControllerAdvice
@Slf4j
@Hidden
public class GlobalExceptionHandler {

    /**
     * 业务异常处理器
     * @param e 业务异常
     * @return 返回错误
     */
    @ExceptionHandler(value = BusinessException.class)
    public BaseResponse<?> handleBusinessException(BusinessException e) {
        log.error("BusinessException", e);
        return ResultUtils.error(e.getCode(), e.getMessage());
    }

    // TODO 封装常量类 Constant
    @ExceptionHandler(value = Exception.class)
    public BaseResponse<?> handleException(Exception e) {
        log.error("Exception", e);
        return ResultUtils.error(ErrorCode.SYSTEM_ERROR, "系统错误");
    }
}
