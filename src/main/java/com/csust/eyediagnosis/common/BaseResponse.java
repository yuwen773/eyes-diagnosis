package com.csust.eyediagnosis.common;

import com.csust.eyediagnosis.exception.ErrorCode;
import lombok.Data;

import java.io.Serializable;

/**
 * @ClassNameBaseResponse
 * @Description 响应对象
 * @Author钰玟
 * @Date2025/4/10 下午8:49
 * @Version 1.0
 **/
@Data
public class BaseResponse<T> implements Serializable {
    /**
     * 状态码
     */
    private int code;
    /**
     * 信息
     */
    private String msg;
    /**
     * 返回的数据
     */
    private T data;

    public BaseResponse(int code, T data, String msg) {
        this.code = code;
        this.msg = msg;
        this.data = data;
    }
    public BaseResponse(int code, T data) {
        this(code,data,"");
    }
    public BaseResponse(ErrorCode errorCode){
        this(errorCode.getCode(), null, errorCode.getMessage());
    }
}
