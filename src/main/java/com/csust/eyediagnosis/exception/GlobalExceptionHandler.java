package com.csust.eyediagnosis.exception;

import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import io.swagger.v3.oas.annotations.Hidden;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;

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

    /**
     * 客户端提前断开（切文档、关抽屉、刷新页面）。
     *
     * <p>文档流是边下边写给浏览器的：管理员在文件没下完时关掉抽屉，容器会在
     * {@code AsyncListener.onError} 这条路上抛 {@link AsyncRequestNotUsableException}。
     * 它不是服务端故障——响应早已提交（状态码与 Content-Type 都已写出去），
     * 此时的正确处理是**不再写任何响应体**，只记一行 info。
     *
     * <p>不专门接住它的话，它会落到上面的兜底分支，打出一条 ERROR 级堆栈，还会
     * 顺带触发一次「往已提交响应里写 JSON」的二次失败（No converter for
     * [BaseResponse]）——把一次正常的用户操作记成两次服务端错误。
     *
     * <p>返回 null：让 Spring 认为响应已处理，不再往 socket 里写任何东西。
     *
     * @param e 容器抛出的「响应已提交、无法再写」异常
     * @return null（不写响应体）
     */
    @ExceptionHandler(value = AsyncRequestNotUsableException.class)
    public BaseResponse<?> handleAsyncRequestNotUsable(AsyncRequestNotUsableException e) {
        log.info("客户端提前断开请求，响应已提交，不再重试: {}", e.getMessage());
        return null;
    }
}
