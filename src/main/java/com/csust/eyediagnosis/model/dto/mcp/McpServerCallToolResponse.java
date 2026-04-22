package com.csust.eyidiagnosis.model.dto.mcp;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.io.Serializable;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class McpServerCallToolResponse implements Serializable {
    private Boolean isError;
    private List<Content> content;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Content implements Serializable {
        private String type;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TextContent extends Content {
        private String text;
    }
}