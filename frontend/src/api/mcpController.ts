/**
 * MCP Server API - 适配层
 * 兼容 VisionSpace McpServicePanel 组件的 API 调用
 */
import request from '@/request'

export const createMcpServer = (data: any) =>
  request('/api/mcp-server', { method: 'POST', data })

export const updateMcpServer = (data: any) =>
  request('/api/mcp-server', { method: 'PUT', data })

export const deleteMcpServer = (mcpServerCode: string) =>
  request(`/api/mcp-server/${mcpServerCode}`, { method: 'DELETE' })

export const getMcpServer = (mcpServerCode: string, needTools = false) =>
  request(`/api/mcp-server/${mcpServerCode}`, { params: { needTools } })

export const listMcpServers = (params: { name?: string; current?: number; size?: number }) =>
  request('/api/mcp-server', { params })
