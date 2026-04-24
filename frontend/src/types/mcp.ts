/**
 * MCP 服务相关类型定义
 */

/**
 * MCP 服务器类型
 */
export type McpServerType = 'stdio' | 'http' | 'sse'

/**
 * MCP 服务器详情
 */
export interface McpServerVO {
  mcpServerCode: string
  name: string
  description?: string
  type: McpServerType
  enabled: boolean
  status?: number
  deployConfig?: string
  host?: string
  installType?: string
  toolCount?: number
  createTime?: string
  updateTime?: string
  [key: string]: any
}

/**
 * MCP 服务器表单数据
 */
export interface McpServerFormData {
  mcpServerCode?: string
  name: string
  description: string
  type: McpServerType
  enabled: boolean
  command: string
  argsText: string
  envText: string
  url: string
  headersText: string
  timeout: number
}

/**
 * 获取服务类型标签
 */
export const getServerTypeLabel = (type?: string): string => {
  const labels: Record<string, string> = {
    stdio: 'STDIO',
    http: 'HTTP',
    sse: 'SSE'
  }
  return labels[type || ''] || '未知'
}
