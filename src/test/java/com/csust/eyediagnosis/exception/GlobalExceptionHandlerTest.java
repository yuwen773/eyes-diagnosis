package com.csust.eyediagnosis.exception;

import org.junit.jupiter.api.Test;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;

import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * 客户端提前断开时的全局处理。
 *
 * <p>文档流是边下边写给浏览器的：管理员在文件没下完时关掉抽屉，容器会在
 * {@code AsyncListener.onError} 这条路上抛 {@link AsyncRequestNotUsableException}。
 * 它不是服务端故障——响应早已提交，此时正确处理是**不再写任何响应体**。
 *
 * <p>不专门接住它，它会落进兜底分支：打出一条 ERROR 级堆栈，还会顺带触发一次
 * 「往已提交响应里写 JSON」的二次失败——一次正常的用户操作被记成两次服务端错误。
 */
class GlobalExceptionHandlerTest {

    @Test
    void clientDisconnectIsHandledWithoutWritingABody() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler();

        AsyncRequestNotUsableException cause =
                new AsyncRequestNotUsableException("Servlet container error notification for disconnected client");

        // 返回 null = 响应已处理，不再往 socket 里写任何东西。
        assertNull(handler.handleAsyncRequestNotUsable(cause));
    }
}
