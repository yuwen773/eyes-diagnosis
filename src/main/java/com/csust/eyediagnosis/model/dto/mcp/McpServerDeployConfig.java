package com.csust.eyediagnosis.model.dto.mcp;

import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * MCP 服务器部署配置。
 *
 * <p>用户配置只放行远程传输（SSE / Streamable HTTP），因此这里只保留 {@code url}。
 * 旧版预留的 STDIO 字段（command / args / envs / envValue / headers 等）在本路径上
 * 只写不读，已随 2026-11-20 卫生清理移除；需要恢复时请一并补上读取方与传输策略。
 */
@Data
@NoArgsConstructor
public class McpServerDeployConfig implements Serializable {

    private static final long serialVersionUID = 1L;

    /** SSE URL（前端传入的 url 字段，直接使用） */
    private String url;
}
