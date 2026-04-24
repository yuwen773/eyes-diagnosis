<template>
  <div class="history-wrapper">
    <!-- 背景装饰 -->
    <div class="bg-decoration">
      <div class="bg-circle bg-circle-1"></div>
      <div class="bg-circle bg-circle-2"></div>
      <div class="bg-orb bg-orb-1"></div>
      <div class="bg-orb bg-orb-2"></div>
    </div>

    <!-- 主要内容 -->
    <div class="history-container">

      <!-- 页面标题区 -->
      <div class="page-hero">
        <div class="hero-text">
          <h1 class="hero-title">
            <span class="hero-title-main">诊断历史</span>
            <span class="hero-title-sub" v-if="total > 0">共 {{ total }} 条记录</span>
          </h1>
          <p class="hero-desc">追踪您的每一次眼部健康诊断，守护视力的每一刻</p>
        </div>
        <div class="hero-stat" v-if="dataList.length > 0">
          <div class="stat-pill">
            <span class="stat-value">{{ dataList.length }}</span>
            <span class="stat-label">本页记录</span>
          </div>
        </div>
      </div>

      <!-- 搜索和筛选区域 -->
      <DiagnosisSearchBar
        v-model:dateRange="dateRange"
        v-model:searchParams="searchParams"
        v-model:selectedRowKeys="selectedRowKeys"
        v-model:selectAll="selectAll"
        :dataList="dataList"
        @search="doSearch"
        @reset="handleReset"
        @dateChange="handleDateChange"
        @export="handleExport"
      />

      <!-- 诊断趋势图表 -->
      <DiagnosisTrendChart :diagnosisData="dataList" class="chart-section" />

      <!-- 数据表格 -->
      <DiagnosisTable
        v-model:selectedRowKeys="selectedRowKeys"
        :dataList="dataList"
        :loading="loading"
        :pagination="pagination"
        @tableChange="doTableChange"
        @viewReport="viewReport"
        @requestReexamine="requestReexamine"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { message } from 'ant-design-vue'
import { listDiagnosisVoByPageWithCache } from '@/api/diagnosisController'
import { useDiagnosisStore } from '@/stores/diagnosis'
import { useLoginUserStore } from '@/stores/user'
import { reexamineDiagnosis } from '@/api/userController'
import DiagnosisTrendChart from '@/components/user/DiagnosisTrendChart.vue'
import DiagnosisSearchBar from '@/components/user/DiagnosisSearchBar.vue'
import DiagnosisTable from '@/components/user/DiagnosisTable.vue'
import { useDiagnosisExport } from '@/composables/useDiagnosisExport'

const diagnosisStore = useDiagnosisStore()
const loginUserStore = useLoginUserStore()
const { exportToCSV, exportToPDF } = useDiagnosisExport()

interface SearchParams {
  current: number
  pageSize: number
  id?: string
  result?: string
}

const loading = ref(false)
const dateRange = ref<import('dayjs').Dayjs[]>([])
const selectedRowKeys = ref<string[]>([])
const selectAll = ref(false)
const dataList = ref<API.DiagnosisManageVO[]>([])
const total = ref(0)
const searchParams = reactive<SearchParams>({ current: 1, pageSize: 10 })

const getSelectedRecords = () => {
  return dataList.value.filter((item) => selectedRowKeys.value.includes(String(item.id)))
}

const handleExport = (format: 'csv' | 'pdf') => {
  const records = getSelectedRecords()
  if (format === 'csv') exportToCSV(records)
  else if (format === 'pdf') exportToPDF(records)
}

const viewReport = (record: API.DiagnosisManageVO) => diagnosisStore.openReportModal(record)

const fetchData = async () => {
  loading.value = true
  const userId = loginUserStore.loginUser.id
  const params = { ...searchParams, userId } as Record<string, unknown>
  if (dateRange.value?.length === 2) {
    params.startDate = dateRange.value[0].format('YYYY-MM-DD')
    params.endDate = dateRange.value[1].format('YYYY-MM-DD')
  }
  try {
    const res = await listDiagnosisVoByPageWithCache(params)
    if (res.data.data) {
      dataList.value = res.data.data.records ?? []
      total.value = res.data.data.total ?? 0
    } else {
      message.error('获取数据失败: ' + res.data.msg)
    }
  } catch {
    message.error('网络错误，请重试')
  } finally {
    loading.value = false
  }
}

const pagination = computed(() => ({
  current: searchParams.current ?? 1,
  pageSize: searchParams.pageSize ?? 10,
  total: Number(total.value) ?? 0,
  showSizeChanger: true,
  showTotal: ((t: number) => `共 ${t} 条`)
}))

const doTableChange = (page: { current: number; pageSize: number }) => {
  searchParams.current = page.current
  searchParams.pageSize = page.pageSize
  fetchData()
}

const doSearch = () => { searchParams.current = 1; fetchData() }

const handleDateChange = () => { searchParams.current = 1; fetchData() }

const handleReset = () => {
  dateRange.value = []
  searchParams.id = undefined
  searchParams.result = undefined
  searchParams.current = 1
  fetchData()
}

const requestReexamine = async (record: API.DiagnosisManageVO) => {
  const res = await reexamineDiagnosis({ diagnosisReexamineDTO: { id: record.id } })
  if (res.data.code === 0) {
    message.success('申请复诊成功！')
    fetchData()
  } else {
    message.error('申请复诊失败: ' + (res.data.msg || '请重试'))
  }
}

onMounted(() => fetchData())
</script>

<style scoped>
/* --- Background decoration --- */
.bg-decoration {
  position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden;
}
.bg-circle {
  position: absolute; border-radius: 50%; opacity: 0.07; filter: blur(60px);
}
.bg-circle-1 { width: 500px; height: 500px; background: var(--claude-brand); top: -200px; right: -100px; animation: drift 25s ease-in-out infinite; }
.bg-circle-2 { width: 350px; height: 350px; background: var(--claude-brand-light); bottom: -150px; left: -80px; animation: drift 30s ease-in-out infinite reverse; }
.bg-orb { position: absolute; border-radius: 50%; opacity: 0.04; filter: blur(40px); }
.bg-orb-1 { width: 200px; height: 200px; background: var(--claude-brand-dark); top: 40%; right: 20%; animation: pulse 20s ease-in-out infinite; }
.bg-orb-2 { width: 150px; height: 150px; background: var(--claude-brand); top: 20%; left: 30%; animation: pulse 15s ease-in-out infinite reverse; }
@keyframes drift { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(25px, -20px); } }
@keyframes pulse { 0%, 100% { transform: scale(1); opacity: 0.04; } 50% { transform: scale(1.15); opacity: 0.07; } }

/* --- Main container --- */
.history-wrapper { min-height: 100vh; background: var(--claude-bg-page); position: relative; overflow: hidden; padding: var(--claude-space-6); }
.history-container { position: relative; z-index: 1; max-width: 1300px; margin: 0 auto; animation: fadeUp 0.5s ease-out; }
@keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }

/* --- Page hero --- */
.page-hero {
  display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: var(--claude-space-6); padding: var(--claude-space-6) var(--claude-space-6) var(--claude-space-5);
  background: var(--claude-bg-elevated); border: 1px solid var(--claude-border-cream); border-radius: var(--claude-radius-xl); position: relative; overflow: hidden;
}
.page-hero::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
  background: linear-gradient(90deg, var(--claude-brand) 0%, var(--claude-brand-light) 50%, transparent 100%);
}
.hero-title { display: flex; align-items: baseline; gap: var(--claude-space-4); margin: 0 0 var(--claude-space-2); }
.hero-title-main { font-family: var(--claude-font-serif); font-size: 28px; font-weight: 700; color: var(--claude-text-primary); letter-spacing: -0.5px; }
.hero-title-sub { font-family: var(--claude-font-sans); font-size: 14px; color: var(--claude-text-tertiary); font-weight: 400; }
.hero-desc { font-size: 14px; color: var(--claude-text-tertiary); margin: 0; }
.stat-pill {
  display: flex; flex-direction: column; align-items: center; padding: var(--claude-space-4) var(--claude-space-5);
  background: linear-gradient(135deg, rgba(201, 100, 66, 0.08) 0%, rgba(201, 100, 66, 0.04) 100%);
  border: 1px solid rgba(201, 100, 66, 0.15); border-radius: var(--claude-radius-lg);
}
.stat-value { font-family: var(--claude-font-serif); font-size: 28px; font-weight: 700; color: var(--claude-brand); line-height: 1; }
.stat-label { font-size: 12px; color: var(--claude-text-tertiary); margin-top: var(--claude-space-1); }

/* --- Chart section spacing --- */
.chart-section { margin-bottom: var(--claude-space-5); }

/* --- Responsive --- */
@media (max-width: 1100px) {
  .page-hero { flex-direction: column; gap: var(--claude-space-4); }
}
@media (max-width: 768px) {
  .history-wrapper { padding: var(--claude-space-3); }
  .page-hero { padding: var(--claude-space-4); }
  .hero-title-main { font-size: 22px; }
}
</style>
