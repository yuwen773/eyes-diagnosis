package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.util.Date;

@Data
@TableName("t_mcp_server")
public class McpServer {

    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("mcpServerCode")
    private String mcpServerCode;

    @TableField("userId")
    private Long userId;

    @TableField("name")
    private String name;

    @TableField("description")
    private String description;

    @TableField("deployConfig")
    private String deployConfig;

    @TableField("status")
    private Integer status;

    @TableField("installType")
    private String installType;

    @TableField("host")
    private String host;

    @TableField(value = "createTime", fill = FieldFill.INSERT)
    private Date createTime;

    @TableField(value = "updateTime", fill = FieldFill.INSERT_UPDATE)
    private Date updateTime;
}
