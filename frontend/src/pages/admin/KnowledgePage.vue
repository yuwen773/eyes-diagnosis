<template>
  <div class="knowledge-page">
    <!-- 上传区域 -->
    <a-card class="mb-4" title="上传文件">
      <a-upload-dragger
        name="file"
        :multiple="true"
        action="/api/knowledge/upload"
        :accept="'.pdf,.doc,.docx,.png,.jpg,.jpeg'"
        @change="handleUploadChange"
      >
        <p class="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p class="ant-upload-text">点击或拖拽文件到此区域上传</p>
        <p class="ant-upload-hint">支持 PDF、Word、图片文件</p>
      </a-upload-dragger>
    </a-card>

    <!-- 文件列表 -->
    <a-card title="文件列表">
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
    </a-card>
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
  padding: 24px;
}
</style>
