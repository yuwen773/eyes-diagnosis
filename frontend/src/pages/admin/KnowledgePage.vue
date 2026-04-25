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
        action="/api/knowledge/upload"
        :accept="'.pdf,.doc,.docx,.png,.jpg,.jpeg'"
        @change="handleUploadChange"
        class="upload-dragger"
      >
        <p class="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p class="ant-upload-text">点击或拖拽文件到此区域上传</p>
      </a-upload-dragger>
    </section>

    <!-- 文件列表 -->
    <section class="list-section">
      <div class="section-header">
        <h3 class="section-title">文件列表</h3>
        <span class="section-meta">{{ fileList.length }} 个文件</span>
      </div>
      <div class="file-table">
        <a-table :columns="columns" :data-source="fileList" :pagination="false">
          <template #bodyCell="{ column, record }">
            <template v-if="column.dataIndex === 'type'">
              <a-tag :color="getTagColor(record.type)">{{ record.type }}</a-tag>
            </template>
            <template v-else-if="column.dataIndex === 'size'">
              {{ formatFileSize(record.size) }}
            </template>
            <template v-else-if="column.dataIndex === 'status'">
              <a-badge
                :status="record.status"
                :text="statusTextMap[record.status]"
              />
            </template>
            <template v-else-if="column.dataIndex === 'uploadTime'">
              {{ dayjs(Number(record.uploadTime)).format('YYYY-MM-DD HH:mm:ss') }}
            </template>
            <template v-else-if="column.key === 'action'">
              <a-space>
                <a-button type="link" size="small">预览</a-button>
                <a-popconfirm
                  title="确定删除该文件？"
                  @confirm="doDelete(record.id)"
                >
                  <a-button type="link" danger size="small">删除</a-button>
                </a-popconfirm>
              </a-space>
            </template>
          </template>
        </a-table>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { message } from 'ant-design-vue'
import { InboxOutlined } from '@ant-design/icons-vue'
import dayjs from 'dayjs'

interface FileItem {
  id: string
  name: string
  type: string
  size: number
  status: 'success' | 'processing' | 'error'
  uploadTime: string
}

const statusTextMap: Record<string, string> = {
  success: '已完成',
  processing: '处理中',
  error: '失败',
}

const columns = [
  {
    title: '文件名',
    dataIndex: 'name',
  },
  {
    title: '类型',
    dataIndex: 'type',
  },
  {
    title: '大小',
    dataIndex: 'size',
  },
  {
    title: '状态',
    dataIndex: 'status',
  },
  {
    title: '上传时间',
    dataIndex: 'uploadTime',
  },
  {
    title: '操作',
    key: 'action',
  },
]

// Mock 数据 —— 后续替换为真实 API
const fileList = ref<FileItem[]>([
  {
    id: '1',
    name: '眼科诊断指南（第三版）.pdf',
    type: 'PDF',
    size: 3145728,
    status: 'success',
    uploadTime: '2026-04-20 14:30:00',
  },
  {
    id: '2',
    name: '糖尿病视网膜病变筛查报告.docx',
    type: 'Word',
    size: 1048576,
    status: 'processing',
    uploadTime: '2026-04-22 09:15:00',
  },
  {
    id: '3',
    name: '眼底图像样本合集.jpg',
    type: '图片',
    size: 524288,
    status: 'success',
    uploadTime: '2026-04-23 11:00:00',
  },
])

/** 格式化文件大小 */
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) {
    return bytes + ' B'
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(2) + ' KB'
  }
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

/** 根据文件类型返回 tag 颜色 */
const getTagColor = (type: string): string => {
  const colorMap: Record<string, string> = {
    PDF: 'red',
    Word: 'blue',
    图片: 'green',
  }
  return colorMap[type] ?? 'default'
}

/** 上传状态回调 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handleUploadChange = (info: any) => {
  const { file } = info
  if (file.status === 'done') {
    message.success(`${file.name} 上传成功`)
    // TODO: 刷新文件列表
  } else if (file.status === 'error') {
    message.error(`${file.name} 上传失败`)
  }
}

/** 删除文件 */
const doDelete = (id: string) => {
  // TODO: 调用真实删除 API
  fileList.value = fileList.value.filter((item) => item.id !== id)
  message.success('删除成功')
}
</script>

<style scoped>
.knowledge-page {
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--claude-space-4);
}

.upload-section,
.list-section {
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

.section-meta {
  font-size: 0.8rem;
  color: var(--claude-text-tertiary);
}

.upload-dragger {
  border-radius: var(--claude-radius-md);
}

.file-table :deep(.ant-table) {
  background: transparent;
}

.file-table :deep(.ant-table-thead > tr > th) {
  background: transparent;
  border-bottom: 1px solid var(--claude-border-warm);
  font-weight: 500;
  color: var(--claude-text-secondary);
}

.file-table :deep(.ant-table-tbody > tr > td) {
  border-bottom: 1px solid var(--claude-border-cream);
}

.file-table :deep(.ant-table-tbody > tr:hover > td) {
  background: var(--color-bg-hover);
}
</style>
