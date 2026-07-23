package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.util.Date;

@Data
@TableName("t_upload_task")
public class UploadTask {

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    private String taskId;

    private Long userId;

    private String objectKey;

    private Integer status;

    private Integer retryCount;

    private String lastError;

    private Date createTime;

    private Date updateTime;
}