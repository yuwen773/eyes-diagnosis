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
import { listMcpServers, createMcpServer, updateMcpServer, deleteMcpServer } from '@/api/mcpController'
import McpServerForm from './McpServerForm.vue'
import type { McpServerVO, McpServerFormData } from '@/types/mcp'
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
  } catch (e) {
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
  } catch (e) {
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
  } catch (e) {
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
  padding: 20px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
}

.panel-content {
  flex: 1;
  overflow: auto;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: #9ca3af;
}

.empty-icon {
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-text {
  font-size: 15px;
  font-weight: 500;
  color: #6b7280;
  margin: 0 0 8px 0;
}

.empty-hint {
  font-size: 13px;
  color: #9ca3af;
  margin: 0;
}

/* 服务列表 */
.server-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.server-card {
  display: flex;
  align-items: center;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 16px 20px;
  transition: all 0.2s ease;
}

.server-card:hover {
  border-color: #d1d5db;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.server-card.editing {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  border-radius: 10px 10px 0 0;
}

.server-info {
  flex: 1;
  cursor: pointer;
  min-width: 0;
}

.server-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.server-name {
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.server-type-tag {
  font-size: 11px;
  padding: 2px 6px;
  background: #f3f4f6;
  color: #6b7280;
  border-radius: 4px;
  flex-shrink: 0;
}

.server-desc {
  font-size: 13px;
  color: #6b7280;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.server-desc.no-desc {
  color: #9ca3af;
}

.server-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  margin-left: 16px;
}

.server-actions :deep(.ant-switch) {
  min-width: 36px;
  height: 20px;
  line-height: 20px;
}

.server-actions :deep(.ant-switch-checked) {
  background: #52c41a;
}

.server-edit-form {
  border: 1px solid #3b82f6;
  border-top: none;
  border-radius: 0 0 10px 10px;
  padding: 20px;
  background: #fff;
}
</style>
