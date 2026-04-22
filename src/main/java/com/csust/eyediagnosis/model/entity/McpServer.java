package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.util.Date;

@Data
@TableName("t_mcp_server")
public class McpServer {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long userId;
    private String mcpServerCode;
    private String mcpServerName;
    private String installType;
    private String host;
    private String deployConfig;
    private Integer status;
    private Date createTime;
    private Date updateTime;
}