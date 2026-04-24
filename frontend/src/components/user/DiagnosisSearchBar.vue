<template>
  <div class="search-section">
    <div class="search-bar">
      <div class="search-fields">
        <a-form layout="inline" :model="searchParams" @finish="() => emit('search')" class="search-form">
          <a-form-item label="日期范围" class="form-item">
            <a-range-picker
              :value="dateRange"
              :placeholder="['开始日期', '结束日期']"
              format="YYYY-MM-DD"
              @change="handleDateChange"
              class="date-picker"
            />
          </a-form-item>
          <a-form-item label="诊断单号" class="form-item">
            <a-input :value="searchParams.id" placeholder="输入诊断单号" class="search-input" allowClear @change="handleIdChange" />
          </a-form-item>
          <a-form-item label="诊断结果" class="form-item">
            <a-input :value="searchParams.result" placeholder="输入诊断结果" class="search-input" allowClear @change="handleResultChange" />
          </a-form-item>
          <a-form-item class="form-item form-item-btn">
            <a-button type="primary" html-type="submit" class="search-btn">
              <template #icon><SearchOutlined /></template>
              搜索
            </a-button>
            <a-button class="reset-btn" @click="() => emit('reset')">
              <template #icon><UndoOutlined /></template>
              重置
            </a-button>
          </a-form-item>
        </a-form>
      </div>

      <!-- 导出操作 -->
      <div class="export-zone">
        <a-checkbox :checked="selectAll" @change="handleSelectAllChange" :disabled="dataList.length === 0" class="select-all">
          全选
        </a-checkbox>
        <a-dropdown :disabled="selectedRowKeys.length === 0" trigger="click">
          <a-button class="export-btn" :class="{ 'export-btn-active': selectedRowKeys.length > 0 }">
            <template #icon><DownloadOutlined /></template>
            导出 {{ selectedRowKeys.length > 0 ? `(${selectedRowKeys.length})` : '全部' }}
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
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  SearchOutlined,
  UndoOutlined,
  DownloadOutlined,
  DownOutlined,
  FileTextOutlined,
  FilePdfOutlined
} from '@ant-design/icons-vue'

interface Props {
  dateRange: import('dayjs').Dayjs[]
  searchParams: { id?: string; result?: string }
  dataList: API.DiagnosisManageVO[]
  selectedRowKeys: string[]
  selectAll: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'search'): void
  (e: 'reset'): void
  (e: 'dateChange'): void
  (e: 'update:dateRange', value: import('dayjs').Dayjs[]): void
  (e: 'update:searchParams', params: { id?: string; result?: string }): void
  (e: 'update:selectedRowKeys', keys: string[]): void
  (e: 'update:selectAll', value: boolean): void
  (e: 'export', format: 'csv' | 'pdf'): void
}>()

const handleDateChange = (dates: import('dayjs').Dayjs[]) => {
  emit('update:dateRange', dates)
  emit('dateChange')
}

const handleIdChange = (e: Event) => {
  emit('update:searchParams', { ...props.searchParams, id: (e.target as HTMLInputElement).value })
}

const handleResultChange = (e: Event) => {
  emit('update:searchParams', { ...props.searchParams, result: (e.target as HTMLInputElement).value })
}

const handleSelectAllChange = (e: Event) => {
  const checked = (e.target as HTMLInputElement).checked
  emit('update:selectAll', checked)
  if (checked) {
    emit('update:selectedRowKeys', props.dataList.map((item) => String(item.id)))
  } else {
    emit('update:selectedRowKeys', [])
  }
}

const handleExportMenuClick = ({ key }: { key: string }) => {
  if (key === 'csv') emit('export', 'csv')
  else if (key === 'pdf') emit('export', 'pdf')
}
</script>

<style scoped>
/* --- Search section --- */
.search-section { margin-bottom: var(--claude-space-5); }
.search-bar {
  display: flex; align-items: flex-end; justify-content: space-between; gap: var(--claude-space-5);
  padding: var(--claude-space-5); background: var(--claude-bg-elevated); border: 1px solid var(--claude-border-cream); border-radius: var(--claude-radius-lg);
}
.search-fields { flex: 1; }
.search-form { display: flex; flex-wrap: wrap; gap: var(--claude-space-3); align-items: flex-end; }
.form-item { margin-bottom: 0; }
.form-item-btn { display: flex; gap: var(--claude-space-2); }

.date-picker { width: 240px; }
.search-input { width: 160px; }

.search-btn {
  background: var(--claude-brand); border-color: var(--claude-brand); height: 38px; padding: 0 20px; border-radius: var(--claude-radius-md);
  transition: all var(--claude-transition-base); font-weight: 500;
}
.search-btn:hover { background: var(--claude-brand-dark) !important; border-color: var(--claude-brand-dark) !important; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(201, 100, 66, 0.3); }

.reset-btn { height: 38px; padding: 0 16px; border-radius: var(--claude-radius-md); border-color: var(--claude-border-warm); color: var(--claude-text-secondary); transition: all var(--claude-transition-base); }
.reset-btn:hover { border-color: var(--claude-brand) !important; color: var(--claude-brand) !important; }

.export-zone { display: flex; align-items: center; gap: var(--claude-space-4); flex-shrink: 0; }
.select-all { font-size: 14px; color: var(--claude-text-secondary); }
.export-btn {
  background: var(--claude-bg-dark); border-color: var(--claude-bg-dark); border-radius: var(--claude-radius-md);
  transition: all var(--claude-transition-base); color: #fff;
}
.export-btn:hover { background: var(--claude-bg-deep) !important; border-color: var(--claude-bg-deep) !important; }
.export-btn-active { background: var(--claude-brand) !important; border-color: var(--claude-brand) !important; }

/* --- Responsive --- */
@media (max-width: 1100px) {
  .search-bar { flex-direction: column; align-items: stretch; }
  .export-zone { justify-content: flex-end; }
}
@media (max-width: 768px) {
  .search-bar { padding: var(--claude-space-4); }
  .search-form { flex-direction: column; }
  .date-picker, .search-input { width: 100%; }
  .form-item { width: 100%; }
  .form-item-btn { flex-direction: row; width: 100%; }
  .search-btn, .reset-btn { flex: 1; }
}
</style>
