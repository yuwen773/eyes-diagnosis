<template>
  <div class="table-section">
    <a-card class="table-card" :bordered="false">
      <template #title>
        <div class="table-header">
          <div class="table-title-group">
            <span class="table-eyebrow">DIAGNOSIS RECORDS</span>
            <span class="table-title-text">诊断记录</span>
          </div>
          <div class="table-meta" v-if="pagination.total > 0">
            <span class="meta-item">
              <ProfileOutlined class="meta-icon" />
              {{ pagination.total }} 条记录
            </span>
          </div>
        </div>
      </template>

      <!-- 加载状态 -->
      <div v-if="loading" class="table-loading">
        <a-spin size="large" />
        <span class="loading-text">正在加载诊断记录...</span>
      </div>

      <!-- 空状态 -->
      <div v-else-if="dataList.length === 0" class="table-empty">
        <div class="empty-illustration">
          <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="60" cy="60" r="56" fill="#f5f4ed" stroke="#e8e6dc" stroke-width="2"/>
            <circle cx="60" cy="50" r="20" stroke="#c96442" stroke-width="2" fill="none"/>
            <path d="M60 70 L60 85" stroke="#c96442" stroke-width="2" stroke-linecap="round"/>
            <path d="M45 100 L75 100" stroke="#c96442" stroke-width="2" stroke-linecap="round"/>
            <path d="M30 35 Q35 25 45 30" stroke="#d97757" stroke-width="1.5" stroke-linecap="round" fill="none"/>
            <path d="M90 35 Q85 25 75 30" stroke="#d97757" stroke-width="1.5" stroke-linecap="round" fill="none"/>
            <circle cx="35" cy="55" r="4" fill="#f0b496" opacity="0.6"/>
            <circle cx="85" cy="55" r="4" fill="#f0b496" opacity="0.6"/>
          </svg>
        </div>
        <h3 class="empty-title">暂无诊断记录</h3>
        <p class="empty-desc">您还没有进行过眼部诊断，开始第一次诊断以追踪您的眼部健康</p>
      </div>

      <!-- 表格 -->
      <div v-else class="table-container">
        <a-table
          :columns="columns"
          :data-source="dataList"
          :loading="loading"
          :pagination="pagination"
          :row-selection="rowSelection"
          @change="handleTableChange"
          rowKey="id"
          class="history-table"
          :scroll="{ x: 1100 }"
        >
          <template #bodyCell="{ column, record }">
            <!-- 诊断单号 -->
            <template v-if="column.key === 'id'">
              <div class="id-cell">
                <span class="id-hash">#</span>
                <span class="id-value">{{ String(record.id).slice(-6).toUpperCase() }}</span>
              </div>
            </template>

            <!-- 诊断日期 -->
            <template v-if="column.key === 'diagnosisTime'">
              <div class="time-cell">
                <div class="time-main">{{ formatDate(record.createTime) }}</div>
                <div class="time-relative">{{ getRelativeTime(record.createTime) }}</div>
              </div>
            </template>

            <!-- 诊断图像 -->
            <template v-if="column.dataIndex === 'diagnosisImage'">
              <div class="image-cell">
                <a-image :src="record.url" :width="64" :height="64" class="diagnosis-thumb" :preview="true" />
              </div>
            </template>

            <!-- 置信度 -->
            <template v-if="column.dataIndex === 'confidence'">
              <div class="confidence-cell">
                <div class="confidence-ring" :style="{ '--pct': record.confidence || 0 }">
                  <svg viewBox="0 0 36 36" class="confidence-svg">
                    <path
                      class="confidence-bg"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                    <path
                      class="confidence-fill"
                      :stroke-dasharray="`${record.confidence || 0}, 100`"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                  </svg>
                  <span class="confidence-pct">{{ record.confidence || 0 }}<small>%</small></span>
                </div>
              </div>
            </template>

            <!-- 诊断结果 -->
            <template v-if="column.key === 'result'">
              <div class="result-cell">
                <span class="result-badge" :class="getResultClass(record.result)">
                  {{ truncateResult(record.result) }}
                </span>
              </div>
            </template>

            <!-- 状态 -->
            <template v-if="column.key === 'status'">
              <div class="status-cell">
                <a-tag :color="getStatusColor(record.status)" class="status-tag" :class="`status-${record.status}`">
                  <template #icon>
                    <CheckCircleOutlined v-if="record.status === '已完成'" />
                    <ClockCircleOutlined v-else-if="record.status === '进行中'" />
                    <CloseCircleOutlined v-else />
                  </template>
                  {{ record.status }}
                </a-tag>
              </div>
            </template>

            <!-- 操作列 -->
            <template v-if="column.key === 'action'">
              <div class="action-buttons">
                <a-button type="link" class="action-btn view-btn" @click="emit('viewReport', record)">
                  <template #icon><FileSearchOutlined /></template>
                  查看
                </a-button>
                <a-divider type="vertical" class="action-divider" />
                <template v-if="record.reexamineStatus === 1">
                  <a-button type="link" class="action-btn reexamine-btn" @click="emit('requestReexamine', record)">
                    <template #icon><ReloadOutlined /></template>
                    复诊
                  </a-button>
                </template>
                <template v-else-if="record.reexamineStatus === 2">
                  <a-tag class="reexamine-tag reexamine-pending">
                    <LoadingOutlined spin /> 复审中
                  </a-tag>
                </template>
                <template v-else-if="record.reexamineStatus === 3">
                  <a-tag class="reexamine-tag reexamine-done">
                    <CheckCircleOutlined /> 已复审
                  </a-tag>
                </template>
              </div>
            </template>
          </template>
        </a-table>
      </div>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  ProfileOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  FileSearchOutlined,
  ReloadOutlined,
  LoadingOutlined
} from '@ant-design/icons-vue'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

interface Props {
  dataList: API.DiagnosisManageVO[]
  loading: boolean
  pagination: { current: number; pageSize: number; total: number; showSizeChanger: boolean }
  selectedRowKeys: string[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'tableChange', pagination: { current: number; pageSize: number }): void
  (e: 'viewReport', record: API.DiagnosisManageVO): void
  (e: 'requestReexamine', record: API.DiagnosisManageVO): void
  (e: 'update:selectedRowKeys', keys: string[]): void
}>()

// --- Helper functions ---
const formatDate = (date: string) => dayjs(Number(date)).format('YYYY-MM-DD HH:mm')
const getRelativeTime = (date: string) => dayjs(Number(date)).fromNow()

const truncateResult = (result: string) => {
  if (!result) return '未知'
  return result.length > 20 ? result.slice(0, 20) + '…' : result
}

const getResultClass = (result: string) => {
  if (!result) return 'result-unknown'
  if (result.includes('正常') || result.includes('健康')) return 'result-normal'
  if (result.includes('白内障') || result.includes('cataract')) return 'result-cataract'
  if (result.includes('青光') || result.includes('glaucoma')) return 'result-glaucoma'
  if (result.includes('糖网') || result.includes('diabetic')) return 'result-retinopathy'
  return 'result-other'
}

const getStatusColor = (status: string) => {
  const map: Record<string, string> = { '已完成': 'green', '进行中': 'blue', '已取消': 'red' }
  return map[status] || 'default'
}

// --- Column definitions ---
const columns = [
  { title: '单号', key: 'id', width: 110, fixed: 'left' },
  { title: '诊断日期', key: 'diagnosisTime', width: 160, sorter: true },
  { title: '图像', dataIndex: 'diagnosisImage', width: 90 },
  { title: '置信度', dataIndex: 'confidence', width: 100 },
  { title: '诊断结果', key: 'result', ellipsis: true },
  { title: '状态', key: 'status', width: 110 },
  { title: '操作', key: 'action', width: 200, fixed: 'right' }
]

// --- Row selection ---
const rowSelection = computed(() => ({
  selectedRowKeys: props.selectedRowKeys,
  onChange: (keys: string[]) => {
    emit('update:selectedRowKeys', keys)
  }
}))

const handleTableChange = (page: { current: number; pageSize: number }) => {
  emit('tableChange', page)
}
</script>

<style scoped>
/* --- Table section --- */
.table-card {
  background: var(--claude-bg-elevated); border: 1px solid var(--claude-border-cream); border-radius: var(--claude-radius-xl); overflow: hidden;
  box-shadow: 0 2px 8px rgba(20, 20, 19, 0.04);
}
.table-header { display: flex; align-items: center; justify-content: space-between; padding: var(--claude-space-4) var(--claude-space-5); border-bottom: 1px solid var(--claude-border-cream); }
.table-title-group { display: flex; flex-direction: column; gap: 2px; }
.table-eyebrow { font-size: 10px; font-weight: 600; letter-spacing: 2px; color: var(--claude-brand); text-transform: uppercase; }
.table-title-text { font-family: var(--claude-font-serif); font-size: 16px; font-weight: 600; color: var(--claude-text-primary); }
.table-meta { display: flex; align-items: center; gap: var(--claude-space-4); }
.meta-item { display: flex; align-items: center; gap: var(--claude-space-2); font-size: 13px; color: var(--claude-text-tertiary); }
.meta-icon { font-size: 14px; color: var(--claude-brand); }

/* --- Loading state --- */
.table-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 80px 0; gap: var(--claude-space-4); }
.loading-text { font-size: 14px; color: var(--claude-text-tertiary); }

/* --- Empty state --- */
.table-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 64px 0; text-align: center; }
.empty-illustration { margin-bottom: var(--claude-space-5); animation: floatEmpty 4s ease-in-out infinite; }
@keyframes floatEmpty { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
.empty-title { font-family: var(--claude-font-serif); font-size: 18px; font-weight: 600; color: var(--claude-text-primary); margin: 0 0 var(--claude-space-3); }
.empty-desc { font-size: 14px; color: var(--claude-text-tertiary); margin: 0; max-width: 360px; line-height: 1.6; }

/* --- Table container --- */
.table-container { padding: 0; }
.history-table :deep(.ant-table) { border-radius: 0; }
.history-table :deep(.ant-table-thead > tr > th) {
  background: var(--claude-bg-page); font-size: 12px; font-weight: 600; letter-spacing: 0.5px; color: var(--claude-text-secondary); border-bottom: 1px solid var(--claude-border-warm);
}
.history-table :deep(.ant-table-tbody > tr > td) { padding: 14px 16px; border-bottom: 1px solid var(--claude-border-cream); }
.history-table :deep(.ant-table-tbody > tr:hover > td) { background: rgba(201, 100, 66, 0.03); }
.history-table :deep(.ant-table-wrapper) { border-radius: 0; }

/* --- Cell styles --- */
.id-cell { display: flex; align-items: center; gap: 2px; font-family: var(--claude-font-mono); font-size: 13px; }
.id-hash { color: var(--claude-text-tertiary); font-weight: 400; }
.id-value { color: var(--claude-text-primary); font-weight: 600; letter-spacing: 1px; }

.time-cell { display: flex; flex-direction: column; gap: 2px; }
.time-main { font-size: 13px; color: var(--claude-text-primary); font-weight: 500; }
.time-relative { font-size: 11px; color: var(--claude-text-tertiary); }

.diagnosis-thumb { border-radius: var(--claude-radius-sm); overflow: hidden; object-fit: cover; border: 1px solid var(--claude-border-cream); transition: all var(--claude-transition-base); cursor: pointer; }
.diagnosis-thumb:hover { border-color: var(--claude-brand); box-shadow: 0 2px 8px rgba(201, 100, 66, 0.2); }

/* Confidence ring */
.confidence-cell { display: flex; align-items: center; justify-content: center; }
.confidence-ring { position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; }
.confidence-svg { width: 44px; height: 44px; transform: rotate(-90deg); }
.confidence-bg { fill: none; stroke: var(--claude-border-cream); stroke-width: 3; }
.confidence-fill { fill: none; stroke: var(--claude-brand); stroke-width: 3; stroke-linecap: round; transition: stroke-dasharray 0.6s ease; }
.confidence-pct { position: absolute; font-family: var(--claude-font-serif); font-size: 11px; font-weight: 700; color: var(--claude-text-primary); line-height: 1; }
.confidence-pct small { font-size: 8px; font-weight: 400; color: var(--claude-text-tertiary); }

/* Result badges */
.result-badge {
  display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 500;
  border: 1px solid transparent; transition: all var(--claude-transition-fast);
}
.result-badge.result-normal { background: rgba(82, 196, 26, 0.1); color: #52c41a; border-color: rgba(82, 196, 26, 0.2); }
.result-badge.result-cataract { background: rgba(201, 100, 66, 0.1); color: var(--claude-brand); border-color: rgba(201, 100, 66, 0.2); }
.result-badge.result-glaucoma { background: rgba(56, 152, 236, 0.1); color: #3898ec; border-color: rgba(56, 152, 236, 0.2); }
.result-badge.result-retinopathy { background: rgba(138, 43, 126, 0.08); color: #8b2f7a; border-color: rgba(138, 43, 126, 0.15); }
.result-badge.result-other { background: rgba(138, 135, 127, 0.1); color: var(--claude-text-secondary); border-color: var(--claude-border-warm); }
.result-badge.result-unknown { background: var(--claude-bg-page); color: var(--claude-text-tertiary); border-color: var(--claude-border-cream); }

/* Status tags */
.status-tag { border-radius: 20px; font-size: 12px; padding: 2px 10px; border: 1px solid transparent; }
.status-tag.status-已完成 { background: rgba(82, 196, 26, 0.1); color: #52c41a; border-color: rgba(82, 196, 26, 0.2); }
.status-tag.status-进行中 { background: rgba(56, 152, 236, 0.1); color: #3898ec; border-color: rgba(56, 152, 236, 0.2); }
.status-tag.status-已取消 { background: rgba(181, 51, 51, 0.08); color: var(--claude-error); border-color: rgba(181, 51, 51, 0.15); }

/* Action buttons */
.action-buttons { display: flex; align-items: center; gap: 0; }
.action-btn { padding: 4px 10px; height: auto; font-size: 13px; border-radius: var(--claude-radius-sm); transition: all var(--claude-transition-fast); }
.action-divider { margin: 0; background: var(--claude-border-cream); }
.view-btn { color: var(--claude-brand); }
.view-btn:hover { background: rgba(201, 100, 66, 0.08); color: var(--claude-brand-dark); }
.reexamine-btn { color: #3898ec; }
.reexamine-btn:hover { background: rgba(56, 152, 236, 0.08); color: #1a5ae0; }
.reexamine-tag { border-radius: 20px; font-size: 12px; padding: 2px 10px; border: 1px solid transparent; display: inline-flex; align-items: center; gap: 4px; }
.reexamine-tag.reexamine-pending { background: rgba(56, 152, 236, 0.1); color: #3898ec; border-color: rgba(56, 152, 236, 0.2); }
.reexamine-tag.reexamine-done { background: rgba(82, 196, 26, 0.1); color: #52c41a; border-color: rgba(82, 196, 26, 0.2); }

/* --- Responsive --- */
@media (max-width: 768px) {
  .history-table :deep(.ant-table) { overflow-x: auto; }
}
</style>
