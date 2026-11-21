package com.csust.eyediagnosis.agent;

/**
 * A tool produced output that cannot be used as evidence: the upstream call came
 * back, but its payload failed structural validation (empty shell, missing
 * required fields, wrong types, illegal enum value…).
 *
 * <p>为什么单独一个类型：它不是「服务不可用」，也不是「框架抛异常」。审计与界面
 * 需要把两者分开——{@link ToolStepContract.ErrorCategory#INVALID_OUTPUT} 与
 * {@code TOOL_EXCEPTION} 是不同的事实。把无效输出混进普通异常里，会让一次
 * 没发生的分析看起来像一次偶发故障，用户重试也没用。
 *
 * <p>抛出方（工具）负责保证 message 不含上游原文：模型对患者影像的描述不进日志、
 * 不进错误文本，只有固定的、面向用户的中文说明。
 */
public class InvalidToolOutputException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public InvalidToolOutputException(String message) {
        super(message);
    }

    public InvalidToolOutputException(String message, Throwable cause) {
        super(message, cause);
    }
}
