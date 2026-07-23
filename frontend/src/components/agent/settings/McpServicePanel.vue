<template>
  <div class="mcp-service-panel">
    <!-- 列表视图 -->
    <template v-if="viewMode === 'list'">
      <!-- 头部 -->
      <div class="panel-header">
        <h3 class="panel-title">MCP 服务配置</h3>
        <a-button type="primary" @click="viewMode = 'create'">
          <template #icon>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </template>
          添加服务
        </a-button>
      </div>

      <!-- 内容区域 -->
      <div class="panel-content">
        <!-- 加载状态 -->
        <a-spin :spinning="loading">
          <!-- 空状态 -->
          <div v-if="!loading && mcpServerList.length === 0" class="empty-state">
            <div class="empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line>
                <line x1="12" y1="17" x2="12" y2="21"></line>
              </svg>
            </div>
            <p class="empty-text">暂无 MCP 服务</p>
            <p class="empty-hint">点击上方"添加服务"创建一个新的 MCP 服务</p>
          </div>

          <!-- 服务列表 -->
          <div v-else class="server-list">
            <div
              v-for="server in mcpServerList"
              :key="server.mcpServerCode"
              class="server-card"
            >
              <!-- 服务信息 -->
              <div class="server-info">
                <div class="server-header">
                  <span class="server-name">{{ server.name }}</span>
                  <span class="server-type-tag">{{ getServerTypeLabel(server.type) }}</span>
                </div>
                <p v-if="server.description" class="server-desc">{{ server.description }}</p>
                <p v-else class="server-desc no-desc">暂无描述</p>
              </div>

              <!-- 右侧操作区域 -->
              <div class="server-actions">
                <a-switch
                  :checked="server.enabled"
                  size="small"
                  @change="(checked: boolean) => handleToggleEnabled(server, checked)"
                />
                <a-button type="link" size="small" @click="startEdit(server.mcpServerCode)">
                  编辑
                </a-button>
                <a-popconfirm
                  title="确定要删除此 MCP 服务吗？"
                  ok-text="确定"
                  cancel-text="取消"
                  @confirm="handleDelete(server.mcpServerCode)"
                >
                  <a-button type="link" size="small" danger>删除</a-button>
                </a-popconfirm>
              </div>
            </div>
          </div>
        </a-spin>
      </div>
    </template>

    <!-- 创建视图 -->
    <template v-else-if="viewMode === 'create'">
      <div class="panel-header">
        <a-button @click="viewMode = 'list'">
          <template #icon>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </template>
          返回列表
        </a-button>
        <h3 class="panel-title">创建 MCP 服务</h3>
      </div>
      <div class="panel-content">
        <McpServerForm
          mode="create"
          :init-mode="formMode"
          @success="handleCreateSuccess"
          @cancel="viewMode = 'list'"
        />
      </div>
    </template>

    <!-- 编辑视图 -->
    <template v-else-if="viewMode === 'edit'">
      <div class="panel-header">
        <a-button @click="viewMode = 'list'">
          <template #icon>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </template>
          返回列表
        </a-button>
        <h3 class="panel-title">编辑 MCP 服务</h3>
      </div>
      <div class="panel-content">
        <McpServerForm
          :server="getServerByCode(editingCode!)"
          mode="edit"
          @success="handleEditSuccess"
          @cancel="viewMode = 'list'"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { listMcpServers, updateMcpServer, deleteMcpServer } from '@/api/mcpController'
import McpServerForm from './McpServerForm.vue'
import type { McpServerVO } from '@/types/mcp'
import { getServerTypeLabel } from '@/types/mcp'

const loading = ref(false)
const mcpServerList = ref<McpServerVO[]>([])
const editingCode = ref('')
const viewMode = ref<'list' | 'create' | 'edit'>('list')
const formMode = ref<'form' | 'json'>('form')

// 开始编辑
const startEdit = (code: string) => {
  editingCode.value = code
  viewMode.value = 'edit'
}

// 解析 deployConfig
const parseDeployConfig = (deployConfig: string) => {
  try {
    const config = JSON.parse(deployConfig)
    const mcpServers = config.mcpServers || {}
    const firstKey = Object.keys(mcpServers)[0]
    const serverConfig = mcpServers[firstKey] || {}
    return {
      type: serverConfig.type || 'stdio',
      command: serverConfig.command || '',
      args: Array.isArray(serverConfig.args) ? serverConfig.args.join('\n') : (serverConfig.args || ''),
      env: serverConfig.env || {},
      url: serverConfig.url || '',
      headers: serverConfig.headers || {}
    }
  } catch (e) {
    console.error('解析 deployConfig 失败:', e)
    return {
      type: 'stdio',
      command: '',
      args: '',
      env: {},
      url: '',
      headers: {}
    }
  }
}

// 加载服务列表
const loadMcpServerList = async () => {
  loading.value = true
  try {
    const res = await listMcpServers({})
    if (res.data.code === 0) {
      // 映射 status -> enabled，并解析 deployConfig
      mcpServerList.value = (res.data.data?.records || []).map((server: any) => {
        const parsed = parseDeployConfig(server.deployConfig || '{}')
        return {
          ...server,
          enabled: server.status === 1,
          type: parsed?.type || server.installType?.toLowerCase() || 'stdio',
          command: parsed?.command || '',
          args: parsed?.args || '',
          env: parsed?.env || {},
          url: parsed?.url || '',
          headers: parsed?.headers || {}
        }
      })
    } else {
      message.error('加载 MCP 服务列表失败: ' + res.data.message)
    }
  } catch {
    message.error('加载 MCP 服务列表失败')
  } finally {
    loading.value = false
  }
}

// 根据 code 获取服务
const getServerByCode = (code: string) => {
  return mcpServerList.value.find(s => s.mcpServerCode === code)
}

// 切换启用状态
const handleToggleEnabled = async (server: McpServerVO, checked: boolean) => {
  try {
    const res = await updateMcpServer({
      mcpServerCode: server.mcpServerCode,
      name: server.name,
      deployConfig: server.deployConfig,
      status: checked ? 1 : 0
    })
    if (res.data.code === 0) {
      message.success(checked ? '已启用' : '已禁用')
      loadMcpServerList()
    } else {
      message.error(res.data.message || '操作失败')
    }
  } catch {
    message.error('操作失败')
  }
}

// 创建成功
const handleCreateSuccess = () => {
  viewMode.value = 'list'
  loadMcpServerList()
}

// 编辑成功
const handleEditSuccess = () => {
  editingCode.value = ''
  viewMode.value = 'list'
  loadMcpServerList()
}

// 删除服务
const handleDelete = async (mcpServerCode: string) => {
  try {
    const res = await deleteMcpServer(mcpServerCode)
    if (res.data.code === 0) {
      message.success('删除成功')
      loadMcpServerList()
    } else {
      message.error(res.data.message || '删除失败')
    }
  } catch {
    message.error('删除失败')
  }
}

onMounted(() => {
  loadMcpServerList()
})
</script>

<style scoped>
.mcp-service-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: var(--space-6, 1.5rem);
  padding-left: var(--space-8, 2rem);
  font-family: var(--font-body, system-ui);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-6, 1.5rem);
  padding-right: var(--space-8, 2rem);
}

.panel-header :deep(.ant-btn) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1, 0.25rem);
  height: 32px;
  padding: 0 var(--space-4, 1rem);
  font-size: var(--text-sm, 0.875rem);
}

.panel-header :deep(.ant-btn svg) {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.panel-title {
  font-family: var(--font-heading, Georgia, serif);
  font-size: 1.375rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--color-near-black, #141413);
  margin: 0;
  line-height: 1.2;
}

.panel-content {
  flex: 1;
  overflow: auto;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-16, 4rem) var(--space-4, 1rem);
  text-align: center;
}

.empty-icon {
  margin-bottom: var(--space-5, 1.25rem);
  opacity: 0.4;
  color: var(--color-olive-gray, #5e5d59);
}

.empty-icon svg {
  width: 48px;
  height: 48px;
}

.empty-text {
  font-size: 1rem;
  font-weight: 500;
  color: var(--color-olive-gray, #5e5d59);
  margin: 0 0 var(--space-2, 0.5rem) 0;
  letter-spacing: 0.01em;
}

.empty-hint {
  font-size: var(--text-xs, 0.75rem);
  color: var(--color-stone-gray, #87867f);
  margin: 0;
  line-height: 1.5;
}

/* Server List */
.server-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 0.75rem);
}

.server-card {
  display: flex;
  align-items: center;
  background: var(--color-ivory, #faf9f5);
  border: 1px solid var(--color-border-default, #e8e6dc);
  border-radius: var(--radius-lg, 12px);
  padding: var(--space-5, 1.25rem) var(--space-6, 1.5rem);
  transition:
    border-color var(--transition-fast, 150ms ease),
    box-shadow var(--transition-fast, 150ms ease);
}

.server-card:hover {
  border-color: var(--color-border-strong, #c2c0b6);
  box-shadow: var(--shadow-sm, 0 1px 2px rgba(20, 20, 19, 0.06));
}

.server-card.editing {
  border-color: var(--claude-brand, #c96442);
  box-shadow: 0 0 0 3px rgba(201, 100, 66, 0.1);
  border-radius: var(--radius-lg, 12px) var(--radius-lg, 12px) 0 0;
}

.server-info {
  flex: 1;
  cursor: pointer;
  min-width: 0;
}

.server-header {
  display: flex;
  align-items: center;
  gap: var(--space-3, 0.75rem);
  margin-bottom: var(--space-1, 0.25rem);
}

.server-name {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--color-near-black, #141413);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: -0.005em;
}

.server-type-tag {
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 2px 6px;
  background: var(--color-bg-tertiary, #f0eee6);
  color: var(--color-olive-gray, #5e5d59);
  border-radius: var(--radius-sm, 4px);
  flex-shrink: 0;
}

.server-desc {
  font-size: 0.8125rem;
  color: var(--color-olive-gray, #5e5d59);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
}

.server-desc.no-desc {
  color: var(--color-stone-gray, #87867f);
  font-style: italic;
}

.server-actions {
  display: flex;
  align-items: center;
  gap: var(--space-4, 1rem);
  flex-shrink: 0;
  margin-left: var(--space-6, 1.5rem);
}

.server-actions :deep(.ant-switch) {
  min-width: 36px;
  height: 20px;
  line-height: 20px;
}

.server-actions :deep(.ant-switch-checked) {
  background: var(--color-success, #52c41a);
}

.server-edit-form {
  border: 1px solid var(--claude-brand, #c96442);
  border-top: none;
  border-radius: 0 0 var(--radius-lg, 12px) var(--radius-lg, 12px);
  padding: var(--space-6, 1.5rem);
  background: var(--color-ivory, #faf9f5);
}
</style>
