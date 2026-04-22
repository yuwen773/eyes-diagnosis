package com.csust.eyediagnosis.model.dto.mcp;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.io.Serializable;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class McpServerDetail implements Serializable {
    private String mcpServerCode;
    private String name;
    private String description;
    private String deployConfig;
    private Integer status;
    private String installType;
    private String host;
    private List<McpTool> tools;
}