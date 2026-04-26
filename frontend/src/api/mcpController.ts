/**
 * MCP Server API
 */
import request from '@/request'

export const createMcpServer = (data: any) =>
  request('/mcp-server', { method: 'POST', data })

export const updateMcpServer = (data: any) =>
  request('/mcp-server', { method: 'PUT', data })

export const deleteMcpServer = (mcpServerCode: string) =>
  request(`/mcp-server/${mcpServerCode}`, { method: 'DELETE' })

export const getMcpServer = (mcpServerCode: string, needTools = false) =>
  request(`/mcp-server/${mcpServerCode}`, { params: { needTools } })

export const listMcpServers = (params: { name?: string; current?: number; size?: number }) =>
  request('/mcp-server', { params })
