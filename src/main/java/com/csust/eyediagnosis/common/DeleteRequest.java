package com.csust.eyediagnosis.common;

import lombok.Data;

import java.io.Serializable;

/**
 * @ClassNameDeleteRequest
 * @Description 删除请求包装类
 * @Author钰玟
 * @Date2025/4/10 下午8:50
 * @Version 1.0
 **/
@Data
public class DeleteRequest implements Serializable {

    /**
     * id
     */
    private Long id;

    private static final long serialVersionUID = 1L;
}
