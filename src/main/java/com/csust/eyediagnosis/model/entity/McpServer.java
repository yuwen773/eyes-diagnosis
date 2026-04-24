package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.util.Date;

@Data
@TableName("mcp_server")
public class McpServer {

    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("mcpServerCode")
    private String mcpServerCode;

    @TableField("userId")
    private Long userId;

    private String name;

    private String description;

    @TableField("deployConfig")
    private String deployConfig;

    private Integer status;

    @TableField("installType")
    private String installType;

    private String host;

    @TableField(value = "gmtCreate", fill = FieldFill.INSERT)
    private Date gmtCreate;

    @TableField(value = "gmtModified", fill = FieldFill.INSERT_UPDATE)
    private Date gmtModified;
}