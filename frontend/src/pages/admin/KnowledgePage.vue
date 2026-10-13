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
        :beforeUpload="beforeUpload"
        :accept="'.pdf,.doc,.docx,.txt,.md'"
        :showUploadList="false"
      >
        <p class="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p class="ant-upload-text">点击或拖拽文件到此区域上传</p>
        <p class="ant-upload-hint">支持 PDF、Word、TXT、Markdown 文件</p>
      </a-upload-dragger>
      <div v-if="pendingFiles.length > 0" class="mt-4 flex gap-2 items-center">
        <span class="text-sm text-gray-500">已选择 {{ pendingFiles.length }} 个文件</span>
        <a-button type="primary" size="small" :loading="uploading" @click="submitBatchUpload">
          开始上传
        </a-button>
        <a-button size="small" @click="clearPendingFiles">清空</a-button>
      </div>
    </section>

    <!-- 处理中的文件队列 -->
    <section v-if="processingFiles.length > 0" class="processing-section">
      <div class="processing-header">
        <InboxOutlined class="processing-icon" />
        <span>正在处理 {{ processingFiles.length }} 个文件...</span>
      </div>
      <div class="processing-list">
        <div v-for="item in processingFiles" :key="item.name" class="processing-item">
          <FileTextOutlined class="file-icon" />
          <span class="processing-name">{{ item.name }}</span>
          <a-badge status="processing" text="正在解析并向量化" class="processing-status" />
        </div>
      </div>
    </section>

    <KnowledgeGovernanceEditor v-if="reviewing" :key="reviewing.id" :document="reviewing"
      @saved="reviewSaved" @cancel="reviewing = null" />
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
          <template v-else-if="column.dataIndex === 'visibility'">
            {{ visibilityLabels[record.visibility] ?? '私人资料' }}
          </template>
          <template v-else-if="column.dataIndex === 'reviewStatus'">
            {{ reviewLabels[record.reviewStatus] ?? '待审核' }}
          </template>
          <template v-else-if="column.dataIndex === 'createTime'">
            {{ dayjs(record.createTime).format('YYYY-MM-DD HH:mm:ss') }}
          </template>
          <template v-else-if="column.dataIndex === 'chunkCount'">
            <span v-if="record.status === 1">{{ record.chunkCount }}</span>
            <span v-else class="text-gray-400">-</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-button type="link" size="small" @click="reviewing = record">审核属性</a-button>
            <a-popconfirm
              v-if="String(record.userId) === String(loginUserStore.loginUser.id)"
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
import { ref, shallowRef, onMounted, onUnmounted, watch } from 'vue'
import KnowledgeGovernanceEditor from '@/components/admin/KnowledgeGovernanceEditor.vue'
import { useLoginUserStore } from '@/stores/user'
import { message } from 'ant-design-vue'
import { InboxOutlined, FileTextOutlined } from '@ant-design/icons-vue'
import dayjs from 'dayjs'
import {
  uploadDocument,
  listReferenceDocuments,
  deleteKnowledge,
  type KnowledgeDocument,
} from '@/api/knowledgeController'

const loading = ref(false)
const loginUserStore = useLoginUserStore()
const visibilityLabels: Record<string, string> = { PRIVATE_USER: '私人资料', CURATED_PUBLIC: '公共参考资料', QUARANTINED: '隔离资料' }
const reviewLabels: Record<string, string> = { PENDING: '待审核', APPROVED: '审核通过', REJECTED: '审核拒绝', WITHDRAWN: '已撤回' }
const reviewing = shallowRef<KnowledgeDocument | null>(null)
const uploading = ref(false)
const fileList = ref<KnowledgeDocument[]>([])
const pendingFiles = ref<File[]>([])
const processingFiles = ref<{ name: string; status: number }[]>([])
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
  { title: '可见范围', dataIndex: 'visibility', width: 150 },
  { title: '审核状态', dataIndex: 'reviewStatus', width: 110 },
  { title: '上传时间', dataIndex: 'createTime', width: 170 },
  { title: '操作', key: 'action', width: 150 },
]

const loadList = async () => {
  loading.value = true
  try {
    const res = await listReferenceDocuments(pagination.value.current, pagination.value.pageSize)
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

function reviewSaved() {
  reviewing.value = null
  message.success('审核属性已保存')
  loadList()
}

const handleTableChange = (pag: any) => {
  pagination.value.current = pag.current
  pagination.value.pageSize = pag.pageSize
  loadList()
}

const beforeUpload = (file: File) => {
  pendingFiles.value.push(file)
  return false // 阻止默认上传行为
}

const submitBatchUpload = async () => {
  if (pendingFiles.value.length === 0) return
  uploading.value = true
  try {
    const res = await uploadDocument(pendingFiles.value)
    if (res.code === 0 && res.data.length > 0) {
      message.success(`${res.data.length} 个文件上传成功，正在处理中...`)
      if (res.msg !== 'ok') {
        message.warning(res.msg, 8)
      }
      // 将上传的文件加入处理队列（初始为处理中状态）
      pendingFiles.value.forEach((file) => {
        processingFiles.value.push({ name: file.name, status: 0 })
      })
      clearPendingFiles()
      loadList()
    } else {
      message.error(res.msg || '上传失败')
    }
  } catch {
    message.error('上传失败')
  } finally {
    uploading.value = false
  }
}

const clearPendingFiles = () => {
  pendingFiles.value = []
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
    loadList()
  }, 3000)
}

// 监听 fileList 变化，将服务器状态同步到 processingFiles 队列
watch(fileList, (list) => {
  const processingNames = new Set(
    list.filter((d) => d.status === 0).map((d) => d.fileName)
  )
  // 保留仍在服务器处理中的文件；已完成的（不在 processingNames 中）自动从队列消失
  processingFiles.value = processingFiles.value.filter((f) =>
    processingNames.has(f.name)
  )
  // 当没有文件在处理时，停止轮询
  if (list.some((d) => d.status === 0)) {
    startPolling()
  } else if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})

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

/* === 处理中队列 === */
.processing-section {
  background: var(--claude-bg-card);
  border-radius: var(--claude-radius-lg);
  padding: var(--claude-space-4) var(--claude-space-5);
  box-shadow: var(--claude-shadow-sm);
  border: 1px solid var(--claude-border-warm);
}

.processing-header {
  display: flex;
  align-items: center;
  gap: var(--claude-space-2);
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--claude-text-primary);
  margin-bottom: var(--claude-space-3);
}

.processing-icon {
  color: var(--claude-brand);
  font-size: 16px;
}

.processing-list {
  display: flex;
  flex-direction: column;
  gap: var(--claude-space-2);
}

.processing-item {
  display: flex;
  align-items: center;
  gap: var(--claude-space-2);
  padding: var(--claude-space-2) var(--claude-space-3);
  background: var(--claude-bg-page);
  border-radius: var(--claude-radius-md);
  border: 1px solid var(--claude-border-cream);
}

.file-icon {
  color: var(--claude-text-tertiary);
  font-size: 14px;
  flex-shrink: 0;
}

.processing-name {
  flex: 1;
  font-size: 0.85rem;
  color: var(--claude-text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.processing-status {
  font-size: 0.8rem;
  flex-shrink: 0;
}
</style>
