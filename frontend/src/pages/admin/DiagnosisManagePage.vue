<template>
  <a-form class="searchForm" layout="inline" :model="searchParams" @finish="doSearch">
    <a-form-item label="疾病名称">
      <a-input v-model:value="searchParams.result" placeholder="输入疾病名称" />
    </a-form-item>
    <a-form-item label="诊断时间">
      <a-input v-model:value="searchParams.diagnosisTime" placeholder="输入诊断时间" />
    </a-form-item>
    <a-form-item>
      <a-button type="primary" html-type="submit">搜索</a-button>
    </a-form-item>
  </a-form>
  <a-table :columns="columns"
           :data-source="dataList"
           :pagination="pagination"
           @change="doTableChange"
           style="margin-top: 15px"
  >
    <template #headerCell="{ column }">
      <template v-if="column.key === 'name'">
        <span>
          <smile-outlined />
          Name
        </span>
      </template>
    </template>
    <!--better view -->
    <template #bodyCell="{ column, text, record }">
      <template v-if="column.dataIndex === 'userName'">
        {{ record.username}}
      </template>
      <template v-if="column.dataIndex === 'confidence'">
        {{ record.confidence}}
        <span v-if="record.confidence">
          %
          </span>
      </template>
      <template v-if="column.dataIndex === 'diagnosisResult'">
        {{ record.result}}
      </template>
      <template v-if="column.dataIndex === 'diagnosisImage'">
        <a-image :src="record.url" :width="120" />
      </template>
      <template v-else-if="column.dataIndex === 'diagnosisTime'">
        {{ dayjs(record.createTime).format('YYYY-MM-DD HH:mm:ss') }}
      </template>
      <template v-else-if="column.key === 'action'">
        <div class="editable-row-operations">
          <span class="deleteBtn">
            <a-button danger @click="doDelete(record.id)">删除</a-button>
          </span>
          <span class="checkBtn">
            <!--查看报告-->
            <a-badge :count="(record.reexamineStatus!=2) ?0:1"
                     :showZero="false"
            >
          <a-button type="primary" ghost @click="viewReport(record)">
            人工复诊
          </a-button>
            </a-badge>

          </span>
        </div>
      </template>
    </template>
  </a-table>
  <!-- 诊断报告详情模态框 -->
  <a-modal
    v-model:open="diagnosisStore.reportModalVisible"
    title="诊断报告详情"
    width="80%"
    :footer="null"
    :destroyOnClose="true"
  >
    <DiagnosisReportDetail
      v-if="diagnosisStore.reportModalVisible"
      :report="diagnosisStore.currentReport"
      @export="handleExport"
    />
  </a-modal>
</template>

<script lang="ts" setup>
import { SmileOutlined } from '@ant-design/icons-vue';
import { computed, onMounted, reactive, ref } from 'vue'
import {
  deleteDiagnosis,
  listDiagnosisVoByPage,
  listDiagnosisVoByPageWithCache
} from '@/api/diagnosisController'
import { message } from 'ant-design-vue'
import dayjs from 'dayjs'
import DiagnosisReportDetail from '@/components/user/DiagnosisReportDetail.vue'
import { useDiagnosisStore } from '@/stores/diagnosis'
const diagnosisStore = useDiagnosisStore();
// 字段
const columns = [
  {
    title: 'id',
    dataIndex: 'id',
  },  {
    title: '诊断用户',
    dataIndex: 'userName',
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
    dataIndex: 'diagnosisResult',
  },
  {
    title: '诊断时间',
    dataIndex: 'diagnosisTime',
  },
  {
    title: '操作',
    key: 'action',
  },
]

//数据
const dataList = ref<API.DiagnosisManageVO[]>([])
const total = ref<number>(0)
//搜索条件
const searchParams = reactive<API.DiagnosisQueryDTO>({
  current: 1,
  pageSize: 10,
})

//获取数据
const fetchData = async () => {
  const res = await listDiagnosisVoByPageWithCache({
    ...searchParams
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
    total: Number(total.value )?? 0, //默认为 0
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
  // 重置页码
  searchParams.current = 1
  fetchData()
}
//删除诊断记录
const doDelete = async (id: string) => {
  if (!id) {
    return
  }
  const res = await deleteDiagnosis({ id })
  if (res.data.code === 0) {
    message.success("删除成功")
    //刷新数据
    fetchData()
  } else {
    message.error('删除失败')
  }
}

//钩子函数 挂载时自动加载
onMounted(() => {
  fetchData()
})

/**
 * 打开模态框
 * @param record 对应的记录条数
 */
const viewReport = (record: any) => {
  diagnosisStore.openReportModal(record)
}
const handleExport = (type: 'pdf' | 'csv') => {
  console.log(`导出报告为${type}格式`, diagnosisStore.currentReport)
}
</script>

<style scoped>
.searchForm {
  margin-left: 15px;
  margin-top: 15px;
}
.deleteBtn{
  margin-right: 5px;
}
.checkBtn{
  margin-left: 5px;
}
</style>
