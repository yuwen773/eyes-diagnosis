<template>
  <div class="manage-page">
    <!-- 搜索栏 -->
    <div class="search-bar">
      <a-input
        v-model:value="searchParams.result"
        placeholder="输入疾病名称"
        style="width: 180px"
        allow-clear
        @pressEnter="doSearch"
      />
      <a-range-picker
        v-model:value="timeRange"
        :show-time="{ defaultValue: [dayjs('00:00:00', 'HH:mm:ss'), dayjs('23:59:59', 'HH:mm:ss')] }"
        format="YYYY-MM-DD HH:mm:ss"
        @change="onTimeRangeChange"
      />
      <a-button type="primary" @click="doSearch">搜索</a-button>
      <a-button @click="resetSearch">重置</a-button>
    </div>

    <!-- 数据表格 -->
    <div class="data-table">
      <a-table
        :columns="columns"
        :data-source="dataList"
        :pagination="pagination"
        :loading="loading"
        @change="doTableChange"
      >
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'diagnosisImage'">
          <a-image
            :src="diagnosisImageUrl(record.url)"
            :width="60"
            class="rounded"
          />
        </template>
        <template v-if="column.dataIndex === 'userName'">
          {{ record.username }}
        </template>
        <template v-if="column.dataIndex === 'diagnosisResult'">
          <a-tag :color="getResultColor(record.result)">
            {{ record.result || '未知' }}
          </a-tag>
        </template>
        <template v-if="column.dataIndex === 'confidence'">
          <a-progress
            :percent="record.confidence ?? 0"
            :stroke-color="getConfidenceColor(record.confidence)"
            size="small"
          />
        </template>
        <template v-if="column.dataIndex === 'humanReviewStatus'">
          <HumanReviewBadge :status="record.humanReviewStatus ?? 'PENDING_AI'" />
          <a-button
            v-if="record.humanReviewStatus !== 'REVIEWED' && record.humanReviewStatus !== 'OVERRIDDEN'"
            size="small"
            type="link"
            @click="openReviewModal(record)"
          >
            提交复核
          </a-button>
        </template>
        <template v-if="column.dataIndex === 'diagnosisTime'">
          {{ dayjs(Number(record.createTime)).format('YYYY-MM-DD HH:mm:ss') }}
        </template>
        <template v-if="column.key === 'action'">
          <div class="flex items-center gap-2">
            <a-button type="primary" ghost size="small" @click="openDrawer(record)">
              查看详情
            </a-button>
            <a-popconfirm
              title="确定删除该诊断记录吗？"
              ok-text="确定"
              cancel-text="取消"
              @confirm="doDelete(record.id)"
            >
              <a-button danger size="small">删除</a-button>
            </a-popconfirm>
          </div>
        </template>
      </template>
    </a-table>
    </div>

    <!-- 诊断详情抽屉 -->
    <a-drawer
      v-model:open="drawerVisible"
      title="诊断详情"
      :width="600"
      :destroy-on-close="true"
    >
      <template v-if="currentRecord">
        <div v-if="currentRecord.url" class="mb-6 text-center">
          <a-image
            :src="diagnosisImageUrl(currentRecord.url)"
            class="rounded"
            style="max-width: 100%; max-height: 300px;"
          />
        </div>
        <a-descriptions bordered :column="1" size="middle">
          <a-descriptions-item label="诊断用户">
            {{ currentRecord.username || '未知' }}
          </a-descriptions-item>
          <a-descriptions-item label="诊断结果">
            <a-tag :color="getResultColor(currentRecord.result)">
              {{ currentRecord.result || '未知' }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="置信度">
            <a-progress
              :percent="currentRecord.confidence ?? 0"
              :stroke-color="getConfidenceColor(currentRecord.confidence)"
            />
          </a-descriptions-item>
          <a-descriptions-item label="严重程度">
            <a-tag :color="getSeverityColor(currentRecord.severity)">
              {{ currentRecord.severity || '未知' }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="诊断时间">
            {{ dayjs(Number(currentRecord.createTime)).format('YYYY-MM-DD HH:mm:ss') }}
          </a-descriptions-item>
        </a-descriptions>
      </template>
    </a-drawer>

    <!-- 人工复核弹窗 -->
    <a-modal
      v-model:open="reviewModalOpen"
      title="人工复核"
      :destroy-on-close="true"
      @ok="submitReview"
    >
      <a-form layout="vertical">
        <a-form-item label="人工结论" required>
          <a-input v-model:value="reviewForm.humanResult" />
        </a-form-item>
        <a-form-item label="严重程度">
          <a-select
            v-model:value="reviewForm.humanSeverity"
            :options="severityOptions"
            allow-clear
          />
        </a-form-item>
        <a-form-item label="建议">
          <a-textarea v-model:value="reviewForm.humanRecommendations" :rows="4" />
        </a-form-item>
        <a-form-item label="备注">
          <a-input v-model:value="reviewForm.humanReviewNote" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { diagnosisImageUrl } from '@/utils/diagnosisImageUrl'
import { computed, onMounted, reactive, ref } from 'vue'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import {
  deleteDiagnosis,
  listDiagnosisVoByPageWithCache,
  updateDiagnosisResult,
} from '@/api/diagnosisController'
import { message } from 'ant-design-vue'
import HumanReviewBadge from '@/components/medical/HumanReviewBadge.vue'

// 表格列定义
const columns = [
  {
    title: 'ID',
    dataIndex: 'id',
    width: 80,
  },
  {
    title: '诊断图像',
    dataIndex: 'diagnosisImage',
    width: 100,
  },
  {
    title: '诊断用户',
    dataIndex: 'userName',
  },
  {
    title: '诊断结果',
    dataIndex: 'diagnosisResult',
  },
  {
    title: '置信度',
    dataIndex: 'confidence',
    width: 150,
  },
  {
    title: '复审状态',
    dataIndex: 'humanReviewStatus',
    width: 180,
  },
  {
    title: '诊断时间',
    dataIndex: 'diagnosisTime',
    width: 180,
  },
  {
    title: '操作',
    key: 'action',
    width: 180,
  },
]

// 数据状态
const dataList = ref<API.DiagnosisManageVO[]>([])
const total = ref<number>(0)
const loading = ref<boolean>(false)

// 搜索参数
const searchParams = reactive<API.DiagnosisQueryDTO>({
  current: 1,
  pageSize: 10,
})

// 时间范围
const timeRange = ref<[Dayjs, Dayjs] | null>(null)

// 抽屉状态
const drawerVisible = ref<boolean>(false)
const currentRecord = ref<API.DiagnosisManageVO | null>(null)

// 人工复核弹窗状态
const reviewModalOpen = ref<boolean>(false)
const reviewTargetId = ref<number | undefined>(undefined)
const reviewForm = reactive({
  humanResult: '',
  humanSeverity: undefined as string | undefined,
  humanRecommendations: '',
  humanReviewNote: '',
})
const severityOptions = [
  { value: 'NOT_ASSESSED', label: '未评估' },
  { value: 'normal', label: '正常' },
  { value: 'low', label: '低风险' },
  { value: 'medium', label: '中风险' },
  { value: 'high', label: '高风险' },
]

// 时间范围变化
const onTimeRangeChange = (dates: [Dayjs, Dayjs] | null) => {
  timeRange.value = dates
}

// 获取数据
const fetchData = async () => {
  loading.value = true
  try {
    const params: API.DiagnosisQueryDTO = {
      ...searchParams,
    }
    if (timeRange.value) {
      params.diagnosisTime = timeRange.value[0].format('YYYY-MM-DD HH:mm:ss')
    }
    const res = await listDiagnosisVoByPageWithCache(params)
    if (res.data.data) {
      dataList.value = res.data.data.records ?? []
      total.value = Number(res.data.data.total) || 0
    } else {
      message.error('获取数据失败：' + (res.data.msg ?? '未知错误'))
    }
  } catch {
    message.error('请求异常，请稍后重试')
  } finally {
    loading.value = false
  }
}

// 分页配置
const pagination = computed(() => ({
  current: searchParams.current ?? 1,
  pageSize: searchParams.pageSize ?? 10,
  total: total.value ?? 0,
  showSizeChanger: true,
  showTotal: (total: number) => `共 ${total} 条数据`,
}))

// 分页变化
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const doTableChange = (page: any) => {
  searchParams.current = page.current
  searchParams.pageSize = page.pageSize
  fetchData()
}

// 搜索
const doSearch = () => {
  searchParams.current = 1
  fetchData()
}

// 重置搜索
const resetSearch = () => {
  searchParams.result = undefined
  searchParams.diagnosisTime = undefined
  timeRange.value = null
  searchParams.current = 1
  fetchData()
}

// 删除诊断记录
const doDelete = async (id: number | undefined) => {
  if (!id) return
  try {
    const res = await deleteDiagnosis({ id })
    if (res.data.code === 0) {
      message.success('删除成功')
      fetchData()
    } else {
      message.error('删除失败：' + (res.data.msg ?? '未知错误'))
    }
  } catch {
    message.error('删除请求异常')
  }
}

// 打开详情抽屉
const openDrawer = (record: API.DiagnosisManageVO) => {
  currentRecord.value = record
  drawerVisible.value = true
}

// 打开人工复核弹窗
const openReviewModal = (record: API.DiagnosisManageVO) => {
  reviewTargetId.value = record.id
  reviewForm.humanResult = ''
  reviewForm.humanSeverity = undefined
  reviewForm.humanRecommendations = ''
  reviewForm.humanReviewNote = ''
  reviewModalOpen.value = true
}

// 提交人工复核：仅写入 human* 字段，AI 字段绝不动
const submitReview = async () => {
  if (!reviewTargetId.value) {
    message.error('缺少诊断 ID')
    return
  }
  if (!reviewForm.humanResult.trim()) {
    message.error('必须填写人工结论')
    return
  }
  try {
    const res = await updateDiagnosisResult({
      id: reviewTargetId.value,
      humanResult: reviewForm.humanResult,
      humanSeverity: reviewForm.humanSeverity,
      humanRecommendations: reviewForm.humanRecommendations,
      humanReviewNote: reviewForm.humanReviewNote,
    })
    if (res.data.code === 0) {
      message.success('复核已提交')
      reviewModalOpen.value = false
      fetchData()
    } else {
      message.error('提交失败：' + (res.data.msg ?? '未知错误'))
    }
  } catch {
    message.error('提交请求异常')
  }
}

// 诊断结果颜色映射
const getResultColor = (result: string | undefined): string => {
  if (!result) return 'default'
  if (result.includes('正常') || result.includes('健康')) return 'green'
  if (result.includes('轻度')) return 'blue'
  if (result.includes('中度')) return 'orange'
  if (result.includes('重度')) return 'red'
  return 'purple'
}

// 置信度颜色
const getConfidenceColor = (confidence: number | undefined): string => {
  const val = confidence ?? 0
  if (val >= 80) return '#52c41a'
  if (val >= 50) return '#faad14'
  return '#ff4d4f'
}

// 严重程度颜色
const getSeverityColor = (severity: string | undefined): string => {
  switch (severity) {
    case '低': return 'green'
    case '中': return 'orange'
    case '高': return 'red'
    default: return 'default'
  }
}

// 挂载时加载数据
onMounted(() => {
  fetchData()
})
</script>

<style scoped>
.manage-page {
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--claude-space-4);
}

.search-bar {
  display: flex;
  align-items: center;
  gap: var(--claude-space-3);
  padding: var(--claude-space-4);
  background: var(--claude-bg-card);
  border-radius: var(--claude-radius-lg);
  box-shadow: var(--claude-shadow-sm);
}

.data-table {
  background: var(--claude-bg-card);
  border-radius: var(--claude-radius-lg);
  padding: var(--claude-space-4);
  box-shadow: var(--claude-shadow-sm);
}

.data-table :deep(.ant-table) {
  background: transparent;
}

.data-table :deep(.ant-table-thead > tr > th) {
  background: transparent;
  border-bottom: 1px solid var(--claude-border-warm);
  font-weight: 500;
  color: var(--claude-text-secondary);
}

.data-table :deep(.ant-table-tbody > tr > td) {
  border-bottom: 1px solid var(--claude-border-cream);
}

.data-table :deep(.ant-table-tbody > tr:hover > td) {
  background: var(--color-bg-hover);
}
</style>
