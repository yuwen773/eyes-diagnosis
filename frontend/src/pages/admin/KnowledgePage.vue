<template>
  <div class="knowledge-page">
    <!-- 上传区域 -->
    <section class="upload-section">
      <div class="section-header">
        <h3 class="section-title">上传文件</h3>
        <span class="section-hint">支持 PDF、Word、图片文件</span>
      </div>
      <a-upload-dragger
        name="file"
        :multiple="true"
        :customRequest="handleUpload"
        :accept="'.pdf,.doc,.docx,.txt,.md'"
        :showUploadList="false"
      >
        <p class="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p class="ant-upload-text">点击或拖拽文件到此区域上传</p>
        <p class="ant-upload-hint">支持 PDF、Word、TXT、Markdown 文件</p>
      </a-upload-dragger>
    </section>

    <!-- 文件列表 -->
    <a-card title="文件列表">
      <a-table
        :columns="columns"
        :data-source="fileList"
        :loading="loading"
        :pagination="pagination"
        @change="handleTableChange"
        row-key="id"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'fileName'">
            {{ record.fileName }}
            <div v-if="record.title && record.title !== record.fileName" class="text-gray-400 text-xs">
              {{ record.title }}
            </div>
          </template>
          <template v-else-if="column.dataIndex === 'fileType'">
            <a-tag :color="getTagColor(record.fileType)">{{ record.fileType.toUpperCase() }}</a-tag>
          </template>
          <template v-else-if="column.dataIndex === 'fileSize'">
            {{ formatFileSize(record.fileSize) }}
          </template>
          <template v-else-if="column.dataIndex === 'status'">
            <a-badge :status="getStatusType(record.status)" :text="getStatusText(record.status)" />
          </template>
          <template v-else-if="column.dataIndex === 'createTime'">
            {{ dayjs(record.createTime).format('YYYY-MM-DD HH:mm:ss') }}
          </template>
          <template v-else-if="column.dataIndex === 'chunkCount'">
            <span v-if="record.status === 1">{{ record.chunkCount }}</span>
            <span v-else class="text-gray-400">-</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-popconfirm
              title="确定删除该文件？删除后知识库中的相关内容也将被移除。"
              @confirm="doDelete(record.id)"
            >
              <a-button type="link" danger size="small">删除</a-button>
            </a-popconfirm>
          </template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { message } from 'ant-design-vue'
import { InboxOutlined } from '@ant-design/icons-vue'
import dayjs from 'dayjs'
import {
  uploadDocument,
  listKnowledgePage,
  deleteKnowledge,
  type KnowledgeDocument,
} from '@/api/knowledgeController'

const loading = ref(false)
const fileList = ref<KnowledgeDocument[]>([])
let pollTimer: ReturnType<typeof setInterval> | null = null

const pagination = ref({
  current: 1,
  pageSize: 10,
  total: 0,
  showSizeChanger: true,
  showTotal: (total: number) => `共 ${total} 条`,
})

const columns = [
  { title: '文件名', dataIndex: 'fileName' },
  { title: '类型', dataIndex: 'fileType', width: 80 },
  { title: '大小', dataIndex: 'fileSize', width: 100 },
  { title: '分块数', dataIndex: 'chunkCount', width: 80 },
  { title: '状态', dataIndex: 'status', width: 100 },
  { title: '上传时间', dataIndex: 'createTime', width: 170 },
  { title: '操作', key: 'action', width: 80 },
]

const loadList = async () => {
  loading.value = true
  try {
    const res = await listKnowledgePage(pagination.value.current, pagination.value.pageSize)
    if (res.code === 0 && res.data) {
      fileList.value = res.data.records
      pagination.value.total = res.data.total
    }
  } catch {
    message.error('加载文件列表失败')
  } finally {
    loading.value = false
  }
}

const handleTableChange = (pag: any) => {
  pagination.value.current = pag.current
  pagination.value.pageSize = pag.pageSize
  loadList()
}

const handleUpload = async (options: any) => {
  const { file, onSuccess, onError } = options
  try {
    const res = await uploadDocument(file)
    if (res.code === 0) {
      message.success(`${file.name} 上传成功，正在处理中...`)
      onSuccess?.(res)
      loadList()
    } else {
      message.error(res.msg || '上传失败')
      onError?.(new Error(res.msg))
    }
  } catch (e: any) {
    message.error(`${file.name} 上传失败`)
    onError?.(e)
  }
}

const doDelete = async (id: number) => {
  try {
    const res = await deleteKnowledge(id)
    if (res.code === 0) {
      message.success('删除成功')
      loadList()
    } else {
      message.error(res.msg || '删除失败')
    }
  } catch {
    message.error('删除失败')
  }
}

const formatFileSize = (bytes: number): string => {
  if (!bytes) return '-'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

const getTagColor = (type: string): string => {
  const map: Record<string, string> = {
    pdf: 'red', doc: 'blue', docx: 'blue', txt: 'green', md: 'orange', markdown: 'orange',
  }
  return map[type?.toLowerCase()] ?? 'default'
}

const getStatusType = (status: number): 'success' | 'processing' | 'error' | 'default' => {
  const map: Record<number, 'success' | 'processing' | 'error' | 'default'> = {
    1: 'success', 0: 'processing', 2: 'error',
  }
  return map[status] ?? 'default'
}

const getStatusText = (status: number): string => {
  const map: Record<number, string> = {
    1: '已完成', 0: '处理中', 2: '失败',
  }
  return map[status] ?? '未知'
}

// Poll for status updates if any document is still processing
const startPolling = () => {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    if (!fileList.value.some((d) => d.status === 0)) {
      clearInterval(pollTimer!)
      pollTimer = null
    } else {
      loadList()
    }
  }, 3000)
}

onMounted(() => {
  loadList().then(() => {
    if (fileList.value.some((d) => d.status === 0)) {
      startPolling()
    }
  })
})

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})

watch(fileList, (list) => {
  if (list.some((d) => d.status === 0)) {
    startPolling()
  }
})
</script>

<style scoped>
.knowledge-page {
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--claude-space-4);
}

.upload-section {
  background: var(--claude-bg-card);
  border-radius: var(--claude-radius-lg);
  padding: var(--claude-space-5);
  box-shadow: var(--claude-shadow-sm);
}

.section-header {
  display: flex;
  align-items: baseline;
  gap: var(--claude-space-3);
  margin-bottom: var(--claude-space-4);
}

.section-title {
  font-family: var(--claude-font-serif);
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--claude-text-primary);
  margin: 0;
  display: inline;
}

.section-hint {
  font-size: 0.8rem;
  color: var(--claude-text-tertiary);
}
</style>
