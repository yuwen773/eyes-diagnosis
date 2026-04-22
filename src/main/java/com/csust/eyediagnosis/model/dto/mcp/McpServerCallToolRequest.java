package com.csust.eyediagnosis.model.dto.mcp;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.io.Serializable;
import java.util.Map;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class McpServerCallToolRequest implements Serializable {
    private String mcpServerCode;
    private String toolName;
    private Map<String, Object> toolParams;
}