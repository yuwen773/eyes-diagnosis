package com.csust.eyidiagnosis.model.dto.mcp;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.io.Serializable;
import java.util.List;
import java.util.Map;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class McpServerDeployConfig implements Serializable {
    private List<String> startCmd;
    private String installConfig;
    private List<String> envs;
    private Map<String, String> envValue;
    private String authorization;
    private String remoteAddress;
    private String remoteEndpoint;
    private Map<String, String> remoteHeader;
    private String command;
    private List<String> args;
    private String url;
}