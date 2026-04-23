<template>
  <div class="mcp-server-form">
    <!-- 表单/JSON 切换 -->
    <div class="form-mode-toggle">
      <a-segmented
        v-model:value="configMode"
        :options="[
          { label: '表单模式', value: 'form' },
          { label: 'JSON 模式', value: 'json' }
        ]"
      />
    </div>

    <!-- JSON 模式 -->
    <div v-if="configMode === 'json'" class="json-config-area">
      <p class="json-hint">可直接修改下方默认模板：</p>
      <a-textarea
        v-model:value="jsonConfig"
        :rows="10"
        class="json-textarea"
      />
      <div v-if="jsonError" class="json-error">{{ jsonError }}</div>
    </div>

    <!-- 表单模式 -->
    <a-form
      v-else
      ref="formRef"
      name="mcp-server-form"
      layout="vertical"
      :model="formData"
      :rules="formRules"
      class="mcp-form"
    >
      <a-form-item label="服务名称" name="name">
        <a-input v-model:value="formData.name" placeholder="请输入服务名称" />
      </a-form-item>

      <a-form-item label="服务描述" name="description">
        <a-textarea v-model:value="formData.description" placeholder="请输入服务描述（可选）" :rows="2" />
      </a-form-item>

      <a-form-item label="服务类型" name="type">
        <a-select v-model:value="formData.type" placeholder="请选择服务类型">
          <a-select-option value="stdio">STDIO</a-select-option>
          <a-select-option value="http">HTTP</a-select-option>
          <a-select-option value="sse">SSE</a-select-option>
        </a-select>
      </a-form-item>

      <!-- STDIO 类型配置 -->
      <template v-if="formData.type === 'stdio'">
        <a-form-item label="命令" name="command">
          <a-input v-model:value="formData.command" placeholder="如: npx, uvx, node" />
        </a-form-item>
        <a-form-item label="参数" name="argsText">
          <a-textarea
            v-model:value="formData.argsText"
            placeholder="每行一个参数，如：
-y
@example/mcp-server"
            :rows="3"
          />
        </a-form-item>
        <a-form-item label="环境变量" name="envText">
          <a-textarea
            v-model:value="formData.envText"
            placeholder="每行一个，格式: KEY=VALUE，如：
MINIMAX_API_KEY=xxx
MINIMAX_API_HOST=https://api.minimaxi.com"
            :rows="3"
          />
        </a-form-item>
      </template>

      <!-- HTTP/SSE 类型配置 -->
      <template v-else>
        <a-form-item label="URL" name="url">
          <a-input v-model:value="formData.url" placeholder="如: https://your-mcp-server/sse" />
        </a-form-item>
        <a-form-item label="请求头" name="headersText">
          <a-textarea
            v-model:value="formData.headersText"
            placeholder="每行一个，格式: Key: Value，如：
Authorization: Bearer xxx"
            :rows="2"
          />
        </a-form-item>
      </template>

      <a-form-item label="超时时间" name="timeout">
        <a-input-number
          v-model:value="formData.timeout"
          :min="1000"
          :max="300000"
          :step="1000"
          style="width: 100%"
        />
        <span class="timeout-hint">毫秒，默认 60000 (1分钟)</span>
      </a-form-item>

      <a-form-item>
        <a-checkbox v-model:checked="formData.enabled">立即启用</a-checkbox>
      </a-form-item>
    </a-form>

    <!-- 操作按钮 -->
    <div class="form-actions">
      <a-button @click="handleCancel">取消</a-button>
      <a-button type="primary" :loading="submitting" @click="handleSubmit">
        {{ isEdit ? '保存' : '创建' }}
      </a-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import type { FormInstance } from 'ant-design-vue'
import { createMcpServer, updateMcpServer } from '@/api/mcpController'
import type { McpServerVO, McpServerFormData } from '@/types/mcp'

interface Props {
  server?: McpServerVO
  mode: 'create' | 'edit'
  initMode?: 'form' | 'json'
}

interface Emits {
  (e: 'success'): void
  (e: 'cancel'): void
}

const props = withDefaults(defineProps<Props>(), {
  initMode: 'form'
})
const emit = defineEmits<Emits>()

const formRef = ref<FormInstance>()
const submitting = ref(false)
const configMode = ref<'form' | 'json'>(props.initMode)
const jsonConfig = ref('')
const jsonError = ref('')

const isEdit = computed(() => props.mode === 'edit')

// 默认表单数据
const defaultFormData: McpServerFormData = {
  name: '',
  description: '',
  type: 'stdio',
  enabled: true,
  command: '',
  argsText: '',
  envText: '',
  url: '',
  headersText: '',
  timeout: 60000
}

const formData = reactive<McpServerFormData>({ ...defaultFormData })

// 表单验证规则
const formRules = {
  name: [{ required: true, message: '请输入服务名称', trigger: 'blur' }],
  type: [{ required: true, message: '请选择服务类型', trigger: 'change' }],
  command: [{ required: true, message: '请输入命令', trigger: 'blur' }],
  url: [{ required: true, message: '请输入 URL', trigger: 'blur' }]
}

// JSON 模式默认模板
const defaultJsonTemplate = {
  mcpServers: {
    "my-server": {
      name: "my-mcp-server",
      type: "stdio",
      command: "npx",
      args: ["-y", "@example/mcp-server"],
      env: {}
    }
  }
}

// 监听配置模式切换
watch(configMode, (newMode) => {
  if (newMode === 'json') {
    jsonConfig.value = buildJsonFromForm()
  } else {
    parseJsonToForm(jsonConfig.value)
  }
})

// 初始化编辑数据
onMounted(() => {
  if (isEdit.value && props.server) {
    // 解析 env 对象为 KEY=VALUE 格式
    let envText = ''
    if (props.server.env && typeof props.server.env === 'object') {
      envText = Object.entries(props.server.env)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n')
    }
    // 解析 args（可能是数组或字符串）
    let argsText = ''
    if (Array.isArray(props.server.args)) {
      argsText = props.server.args.join('\n')
    } else if (typeof props.server.args === 'string') {
      argsText = props.server.args
    }

    Object.assign(formData, {
      mcpServerCode: props.server.mcpServerCode,
      name: props.server.name || '',
      description: props.server.description || '',
      type: props.server.type || 'stdio',
      enabled: props.server.enabled ?? true,
      command: props.server.command || '',
      argsText: argsText,
      envText: envText,
      url: props.server.url || '',
      headersText: '',
      timeout: props.server.timeout || 60000
    })
  } else {
    // 创建模式默认显示 JSON 模板
    jsonConfig.value = JSON.stringify(defaultJsonTemplate, null, 2)
  }
})

// 从表单数据构建 JSON
const buildJsonFromForm = (): string => {
  const config: Record<string, any> = {
    name: formData.name,
    type: formData.type,
    enabled: formData.enabled
  }

  if (formData.description) {
    config.description = formData.description
  }

  if (formData.type === 'stdio') {
    config.command = formData.command
    if (formData.argsText) {
      config.args = formData.argsText.split('\n').filter((line) => line.trim())
    }
    if (formData.envText) {
      config.env = {}
      formData.envText.split('\n').forEach((line) => {
        const [key, ...valueParts] = line.split('=')
        if (key && valueParts.length > 0) {
          config.env[key.trim()] = valueParts.join('=').trim()
        }
      })
    }
  } else if (formData.type === 'http' || formData.type === 'sse') {
    config.url = formData.url
    if (formData.headersText) {
      config.headers = {}
      formData.headersText.split('\n').forEach((line) => {
        const [key, ...valueParts] = line.split(':')
        if (key && valueParts.length > 0) {
          config.headers[key.trim()] = valueParts.join(':').trim()
        }
      })
    }
  }

  if (formData.timeout && formData.timeout !== 60000) {
    config.timeout = formData.timeout
  }

  return JSON.stringify({
    mcpServers: {
      [formData.name || 'my-server']: config
    }
  }, null, 2)
}

// 解析 JSON 到表单数据
const parseJsonToForm = (jsonStr: string) => {
  try {
    const config = JSON.parse(jsonStr)
    const mcpServers = config.mcpServers || {}
    const firstKey = Object.keys(mcpServers)[0]
    const serverConfig = mcpServers[firstKey] || {}

    formData.name = serverConfig.name || firstKey || ''
    formData.description = serverConfig.description || ''
    formData.type = serverConfig.type || 'stdio'
    formData.enabled = serverConfig.enabled ?? true
    formData.command = serverConfig.command || ''
    formData.argsText = Array.isArray(serverConfig.args) ? serverConfig.args.join('\n') : ''
    formData.envText = Object.entries(serverConfig.env || {})
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')
    formData.url = serverConfig.url || ''
    formData.headersText = Object.entries(serverConfig.headers || {})
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n')
    formData.timeout = serverConfig.timeout || 60000
    jsonError.value = ''
  } catch (e) {
    jsonError.value = 'JSON 格式错误，请检查'
  }
}

// 从 JSON 中提取 name
const extractNameFromJson = (config: any): string => {
  if (config.mcpServers) {
    const firstServer = Object.values(config.mcpServers)[0] as Record<string, any>
    if (firstServer && firstServer.name) {
      return firstServer.name
    }
    const firstKey = Object.keys(config.mcpServers)[0]
    if (firstKey) {
      return firstKey
    }
  }
  return config.name || ''
}

// 取消
const handleCancel = () => {
  emit('cancel')
}

// 提交
const handleSubmit = async () => {
  submitting.value = true
  try {
    if (configMode.value === 'json') {
      // JSON 模式 - 只解析一次
      let config: Record<string, any>
      try {
        config = JSON.parse(jsonConfig.value)
        jsonError.value = ''
      } catch (e) {
        jsonError.value = 'JSON 格式错误，请检查'
        return
      }

      let deployConfigJson = jsonConfig.value

      // 如果没有 mcpServers 结构，包装一下
      if (!config.mcpServers) {
        const jsonName = extractNameFromJson(config)
        deployConfigJson = JSON.stringify({
          mcpServers: {
            [jsonName || 'my-server']: config
          }
        })
      }

      const submitData: Record<string, any> = {
        deployConfig: deployConfigJson
      }

      const jsonName = extractNameFromJson(config)
      if (jsonName) {
        submitData.name = jsonName
      }
      // 从 JSON 配置中提取 installType
      if (config.mcpServers) {
        const firstServer = Object.values(config.mcpServers)[0] as Record<string, any>
        if (firstServer && firstServer.type) {
          submitData.installType = firstServer.type.toUpperCase()
        }
      }
      if (formData.description) {
        submitData.description = formData.description
      }

      if (isEdit.value) {
        submitData.mcpServerCode = props.server?.mcpServerCode
        const res = await updateMcpServer(submitData)
        if (res.data.code === 0) {
          message.success('更新成功')
          emit('success')
        } else {
          message.error(res.data.message || '更新失败')
        }
      } else {
        const res = await createMcpServer(submitData)
        if (res.data.code === 0) {
          message.success('创建成功')
          emit('success')
        } else {
          message.error(res.data.message || '创建失败')
        }
      }
    } else {
      // 表单模式
      await formRef.value?.validate()

      // 构建 deployConfig
      const serverConfig: Record<string, any> = {
        name: formData.name,
        type: formData.type,
        enabled: formData.enabled
      }

      if (formData.description) {
        serverConfig.description = formData.description
      }

      if (formData.type === 'stdio') {
        serverConfig.command = formData.command
        if (formData.argsText) {
          serverConfig.args = formData.argsText.split('\n').filter((line) => line.trim())
        }
        if (formData.envText) {
          serverConfig.env = {}
          formData.envText.split('\n').forEach((line) => {
            const [key, ...valueParts] = line.split('=')
            if (key && valueParts.length > 0) {
              serverConfig.env[key.trim()] = valueParts.join('=').trim()
            }
          })
        }
      } else {
        serverConfig.url = formData.url
        if (formData.headersText) {
          serverConfig.headers = {}
          formData.headersText.split('\n').forEach((line) => {
            const [key, ...valueParts] = line.split(':')
            if (key && valueParts.length > 0) {
              serverConfig.headers[key.trim()] = valueParts.join(':').trim()
            }
          })
        }
      }

      if (formData.timeout && formData.timeout !== 60000) {
        serverConfig.timeout = formData.timeout
      }

      const deployConfig = {
        mcpServers: {
          [formData.name]: serverConfig
        }
      }

      const submitData: Record<string, any> = {
        name: formData.name,
        deployConfig: JSON.stringify(deployConfig),
        installType: formData.type.toUpperCase()
      }

      if (formData.description) {
        submitData.description = formData.description
      }

      if (isEdit.value) {
        submitData.mcpServerCode = props.server?.mcpServerCode
        const res = await updateMcpServer(submitData)
        if (res.data.code === 0) {
          message.success('更新成功')
          emit('success')
        } else {
          message.error(res.data.message || '更新失败')
        }
      } else {
        const res = await createMcpServer(submitData)
        if (res.data.code === 0) {
          message.success('创建成功')
          emit('success')
        } else {
          message.error(res.data.message || '创建失败')
        }
      }
    }
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.mcp-server-form {
  padding: 8px 0;
}

.form-mode-toggle {
  margin-bottom: 20px;
}

.json-config-area {
  margin-bottom: 16px;
}

.json-hint {
  font-size: 13px;
  color: #6b7280;
  margin: 0 0 8px 0;
}

.json-textarea {
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 12px;
}

.json-error {
  color: #ef4444;
  font-size: 12px;
  margin-top: 8px;
}

.mcp-form {
  margin-bottom: 16px;
}

.timeout-hint {
  font-size: 12px;
  color: #9ca3af;
  margin-left: 8px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 16px;
  border-top: 1px solid #f3f4f6;
  margin-top: 16px;
}
</style>
