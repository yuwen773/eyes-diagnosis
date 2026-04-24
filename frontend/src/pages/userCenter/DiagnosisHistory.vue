<template>
<!--
  <div class="history-wrapper">
    &lt;!&ndash; 背景层 &ndash;&gt;
    <div class="background-layer"></div>

    &lt;!&ndash; 诊断历史内容 &ndash;&gt;
    <div class="history-container">
      <a-page-header title="诊断历史" />

      <div class="history-actions">
        &lt;!&ndash;日期筛选&ndash;&gt;
        <a-range-picker
          v-model:value="dateRange"
          :placeholder="['开始日期', '结束日期']"
          @change="handleDateChange"
        />
        <a-input-search
          v-model="searchParams"
          placeholder="搜索诊断记录"
          @search="doSearch"
          style="width: 300px"
        />
      </div>

      <a-table
        :columns="columns"
        :data-source="dataList"
        :loading="loading"
        :pagination="pagination"
        @change="doTableChange"
        rowKey="id"
        class="history-table"
      >

      </a-table>
    </div>
  </div>-->
  <div class="history-wrapper">
    <!-- 背景层 -->
    <div class="background-layer"></div>

    <!-- 诊断历史内容 -->
    <div class="history-container">
      <a-page-header title="诊断历史" />
      <div class="history-actions" style="margin-bottom: 30px">
      <a-form class="searchForm" layout="inline" :model="searchParams" @finish="doSearch">
        <a-form-item label="日期范围">
          <a-range-picker
            v-model:value="dateRange"
            :placeholder="['开始日期', '结束日期']"
            format="YYYY-MM-DD"
            @change="handleDateChange"
          />
        </a-form-item>
        <a-form-item label="诊断Id">
          <a-input v-model:value="searchParams.id" placeholder="输入诊断单号" style="width: 300px" />
        </a-form-item>
        <a-form-item label="结果">
          <a-input v-model:value="searchParams.result" placeholder="输入诊断结果"  style="width: 300px" />
        </a-form-item>
        <a-form-item >
          <a-button type="primary" html-type="submit">搜索</a-button>
        </a-form-item>
      </a-form>
      <div class="export-actions">
        <a-checkbox v-model:checked="selectAll" @change="handleSelectAll" :disabled="dataList.length === 0">全选</a-checkbox>
        <a-dropdown :disabled="selectedRowKeys.length === 0">
          <a-button type="primary">
            导出全部
            <DownOutlined />
          </a-button>
          <template #overlay>
            <a-menu @click="handleExportMenuClick">
              <a-menu-item key="csv">
                <FileTextOutlined /> 导出为 CSV
              </a-menu-item>
              <a-menu-item key="pdf">
                <FilePdfOutlined /> 导出为 PDF
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
        <span v-if="selectedRowKeys.length > 0" class="selected-count">已选择 {{ selectedRowKeys.length }} 条</span>
      </div>
      </div>
      <!-- Diagnosis Trend Charts -->
      <DiagnosisTrendChart :diagnosisData="dataList" />
      <div class="table-container">
        <a-table
          :columns="columns"
          :data-source="dataList"
          :loading="loading"
          :pagination="pagination"
          :row-selection="rowSelection"
          @change="doTableChange"
          rowKey="id"
          class="history-table"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.dataIndex === 'confidence'">
              {{ record.confidence}}
              <span v-if="record.confidence">
          %
          </span>
            </template>
            <!--诊断日期-->
            <template v-if="column.key === 'diagnosisTime'">
              {{ formatDate(record.createTime) }}
            </template>
            <template v-if="column.dataIndex === 'diagnosisImage'">
              <a-image :src="record.url" :width="120" />
            </template>
            <!--诊断状态-->
            <template v-else-if="column.key === 'status'">
              <a-tag :color="getStatusColor(record.status)">
                {{ record.status }}
              </a-tag>
            </template>
            <template v-else-if="column.key === 'action'">
              <!--查看报告-->
              <a-button type="link" @click="viewReport(record)">
                查看报告
              </a-button>
              <a-button v-if="record.reexamineStatus===1"  type="link" @click="requestReexamine(record)">
                  申请复诊
              </a-button>
              <a-button v-if="record.reexamineStatus===2"  type="link" disabled @click="requestReexamine(record)">
                复审中
              </a-button>
              <a-button v-if="record.reexamineStatus===3"  type="link" disabled @click="requestReexamine(record)">
                已复审
              </a-button>
            </template>
          </template>
        </a-table>
      </div>
    </div>
  </div>


</template>

<script lang="ts" setup>
import { ref, reactive, onMounted, getCurrentInstance, computed } from 'vue'
import { useUserStore } from '@/stores/userCenter'
import DiagnosisTrendChart from '@/components/user/DiagnosisTrendChart.vue'
import dayjs from 'dayjs'
import { DownOutlined, FileTextOutlined, FilePdfOutlined } from '@ant-design/icons-vue'

const diagnosisStore = useDiagnosisStore();
const userStore = useUserStore()
const loading = ref(false)
const dateRange = ref<any>([])

// 批量选择相关
const selectedRowKeys = ref<string[]>([])
const selectAll = ref(false)

// 表格行选择配置
const rowSelection = computed(() => ({
  selectedRowKeys: selectedRowKeys.value,
  onChange: (keys: string[]) => {
    selectedRowKeys.value = keys
    selectAll.value = keys.length === dataList.value.length && dataList.value.length > 0
  }
}))

// 全选操作
const handleSelectAll = () => {
  if (selectAll.value) {
    selectedRowKeys.value = dataList.value.map((item: any) => item.id)
  } else {
    selectedRowKeys.value = []
  }
}

// 获取选中的记录
const getSelectedRecords = () => {
  return dataList.value.filter((item: any) => selectedRowKeys.value.includes(item.id))
}

// 导出为 CSV
const exportToCSV = () => {
  const records = getSelectedRecords()
  if (records.length === 0) return

  const headers = ['诊断单号', '诊断日期', '诊断结果', '置信度', '状态']
  const csvContent = [
    headers.join(','),
    ...records.map((record: any) => [
      record.id,
      formatDate(record.createTime),
      `"${record.result || ''}"`,
      record.confidence ? `${record.confidence}%` : '',
      record.status || ''
    ].join(','))
  ].join('\n')

  const BOM = '﻿'
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `诊断记录_${dayjs().format('YYYYMMDD_HHmmss')}.csv`
  link.click()
  URL.revokeObjectURL(url)
  message.success(`成功导出 ${records.length} 条记录为 CSV`)
}

// 导出为 PDF
const exportToPDF = () => {
  const records = getSelectedRecords()
  if (records.length === 0) return

  const printContent = `
    <html>
    <head>
      <meta charset="utf-8">
      <title>诊断记录导出</title>
      <style>
        body { font-family: 'Microsoft YaHei', Arial, sans-serif; padding: 20px; }
        h1 { text-align: center; color: #333; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #f5f5f5; }
        .header { background: #1890ff; color: white; }
      </style>
    </head>
    <body>
      <h1>眼科诊断记录</h1>
      <p>导出时间: ${dayjs().format('YYYY-MM-DD HH:mm:ss')}</p>
      <table>
        <thead>
          <tr class="header">
            <th>诊断单号</th>
            <th>诊断日期</th>
            <th>诊断结果</th>
            <th>置信度</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          ${records.map((record: any) => `
            <tr>
              <td>${record.id}</td>
              <td>${formatDate(record.createTime)}</td>
              <td>${record.result || ''}</td>
              <td>${record.confidence ? record.confidence + '%' : ''}</td>
              <td>${record.status || ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </body>
    </html>
  `

  const printWindow = window.open('', '_blank')
  if (printWindow) {
    printWindow.document.write(printContent)
    printWindow.document.close()
    printWindow.print()
  }
}

// 导出菜单点击处理
const handleExportMenuClick = ({ key }: { key: string }) => {
  if (key === 'csv') {
    exportToCSV()
  } else if (key === 'pdf') {
    exportToPDF()
  }
}
//表格字段名称
const columns = [
  {
    title: '诊断单号',
    dataIndex: 'id',
    key: 'id',
    width: 120
  },
  {
    title: '诊断日期',
    dataIndex: 'diagnosisTime',
    key: 'diagnosisTime',
    sorter: true
  },
  {
    title: '置信度',
    dataIndex: 'confidence',
  },
  {
    title: '诊断图像',
    dataIndex: 'diagnosisImage',
  },
  {
    title: '诊断结果',
    dataIndex: 'result',
    key: 'result'
  },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
  },
  {
    title: '操作',
    key: 'action',
  }
]



//数据
const dataList = ref<API.DiagnosisManageVO[]>([])
const total = ref(0)
//搜索条件
const searchParams = reactive<API.DiagnosisQueryDTO>({
  current: 1,
  pageSize: 10,
})


//格式化日期
const formatDate = (date: string) => {
  return dayjs(Number(date)).format('YYYY-MM-DD HH:mm')
}
//状态=>颜色展示
const getStatusColor = (status: string) => {
  const statusColors: Record<string, string> = {
    '已完成': 'green',
    '进行中': 'blue',
    '已取消': 'red'
  }
  return statusColors[status] || 'default'
}





//查看详情报告
import { message } from 'ant-design-vue'
import { listDiagnosisVoByPage, listDiagnosisVoByPageWithCache } from '@/api/diagnosisController'
import { useDiagnosisStore } from '@/stores/diagnosis'
import { useLoginUserStore } from '@/stores/user'
import { reexamineDiagnosis } from '@/api/userController'
const viewReport = (record: any) => {
  diagnosisStore.openReportModal(record)
}
const loginUserStore = useLoginUserStore()
//获取数据
const fetchData = async () => {
  const userId = loginUserStore.loginUser.id
  const res = await listDiagnosisVoByPageWithCache({
    ...searchParams,
    userId
  })
  if (res.data.data) {
    dataList.value = res.data.data.records ?? []
    total.value = res.data.data.total ?? 0
  } else {
    message.error('获取数据失败' + res.data.msg)
  }
}

//分页参数
const pagination = computed(() => {
  return {
    current: searchParams.current ?? 1, //有则按照传过来的，否则默认为1
    pageSize: searchParams.pageSize ?? 10, //默认为 10
    total: Number(total.value ) ?? 0, //默认为 0
    showSizeChanger: true,
    showTotal: ((total) => `共${total}条数据`),
  }
})
// 分页参数变化时的监视
const doTableChange = (page: any) => {
  searchParams.current = page.current,
    searchParams.pageSize = page.pageSize
  fetchData()
}
// 获取数据(搜索)
const doSearch = () => {
  console.log(searchParams)
  // 重置页码
  searchParams.current = 1
  fetchData()
}



//
const handleDateChange = () => {
  searchParams.current = 1
  fetchData()
}
//查询 TODO
// const handleSearch = () => {
//   pagination.current = 1
//   loadDiagnosisHistory()
// }

const requestReexamine = async (record: any) => {
  const recordId = record.id;
  const res = await reexamineDiagnosis({
    id: recordId
  })
  if(res.data.code ===0 && res.data.data!=null){
    message.success("申请复诊成功！")
  }
  else{
    message.error("申请复诊失败,请重试！")
  }
}
onMounted(() => {
  fetchData()
})
</script>

<style scoped>
.history-wrapper {

  min-height: 100vh;
  background-size: cover;
  position: relative;
  overflow: hidden;
  padding: 20px;
}

.background-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: inherit;
  filter: blur(8px);
  z-index: 0;
}

.history-container {
  position: relative;
  z-index: 1;
  max-width: 1400px;
  margin: 0 auto;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 24px;
  overflow: hidden;
}

.table-container {
  max-height: 35vh; /* 限制表格容器高度 */
  overflow-y: auto; /* 启用垂直滚动 */
  margin-top: 16px;
  scroll-behavior: smooth; /* 平滑滚动效果 */
/*  margin-bottom: 50px;*/
}

/* 自定义滚动条样式 */
.table-container::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.table-container::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.05);
  border-radius: 4px;
}

.table-container::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
}

.table-container::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.3);
}

.history-actions {
  display: flex;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 16px;
  flex-wrap: wrap;
}

.export-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}

.selected-count {
  color: var(--color-primary, #1890ff);
  font-size: 14px;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .history-actions {
    flex-direction: column;
  }

  .history-actions .ant-input-search {
    width: 100% !important;
  }

  .table-container {
    max-height: 60vh;
  }
}
</style>
