<template>
  <div class="mb-4 flex items-center gap-3">
    <a-input
      v-model:value="searchParams.title"
      placeholder="输入新闻标题"
      allow-clear
      @press-enter="doSearch"
    />
    <a-button type="primary" @click="doSearch">搜索</a-button>
    <a-button @click="doReset">重置</a-button>
    <div class="flex-1"></div>
    <a-button type="primary" @click="editNews(null)">新增新闻</a-button>
  </div>

  <a-table
    :columns="columns"
    :data-source="dataList"
    :pagination="pagination"
    :loading="loading"
    @change="doTableChange"
  >
    <template #bodyCell="{ column, record }">
      <template v-if="column.dataIndex === 'newsContent'">
        <div v-html="record.newsContent"></div>
      </template>
      <template v-else-if="column.dataIndex === 'publishTime'">
        {{ dayjs(Number(record.publishTime)).format('YYYY-MM-DD HH:mm:ss') }}
      </template>
      <template v-else-if="column.dataIndex === 'author'">
        {{ record.author }}
      </template>
      <template v-else-if="column.key === 'action'">
        <a-space>
          <a-button @click="editNews(record.id)">编辑</a-button>
          <a-popconfirm title="确定删除该新闻？" @confirm="doDelete(record.id)">
            <a-button danger>删除</a-button>
          </a-popconfirm>
        </a-space>
      </template>
    </template>
  </a-table>
</template>

<script lang="ts" setup>
import { computed, onMounted, reactive, ref } from 'vue'
import {
  deleteNews,
  listNewsVoByPageWithCache,
} from '@/api/newsController'
import { message } from 'ant-design-vue'
import dayjs from 'dayjs'
import { useRouter } from 'vue-router'

// 字段
const columns = [
  {
    title: 'id',
    dataIndex: 'id',
  },
  {
    title: '新闻标题',
    dataIndex: 'title',
  },
  {
    title: '新闻摘要',
    dataIndex: 'summary',
  },
  {
    title: '发布时间',
    dataIndex: 'publishTime',
  },
  {
    title: '作者',
    dataIndex: 'author',
  },
  {
    title: '操作',
    key: 'action',
  },
]

// 数据
const dataList = ref<API.NewsVO[]>([])
const total = ref(0)
const loading = ref(false)

// 搜索条件
const searchParams = reactive<API.NewsQueryDTO>({
  current: 1,
  pageSize: 10,
})

// 获取数据
const fetchData = async () => {
  loading.value = true
  try {
    const res = await listNewsVoByPageWithCache({
      ...searchParams,
    })
    if (res.data.data) {
      dataList.value = res.data.data.records ?? []
      total.value = Number(res.data.data.total) || 0
    } else {
      message.error('获取数据失败' + res.data.msg)
    }
  } finally {
    loading.value = false
  }
}

// 分页参数
const pagination = computed(() => {
  return {
    current: searchParams.current ?? 1,
    pageSize: searchParams.pageSize ?? 10,
    total: Number(total.value) ?? 0,
    showSizeChanger: true,
    showTotal: ((total: number) => `共${total}条数据`),
  }
})

// 分页参数变化
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

// 重置
const doReset = () => {
  searchParams.title = ''
  searchParams.current = 1
  fetchData()
}

// 删除新闻
const doDelete = async (id: string) => {
  if (!id) {
    return
  }
  const res = await deleteNews({ id: Number(id) })
  if (res.data.code === 0) {
    message.success('删除成功')
    fetchData()
  } else {
    message.error('删除失败')
  }
}

const router = useRouter()

const editNews = async (id: string | null) => {
  router.push({
    path: `/news/edit/${id}`,
  })
}

// 挂载时自动加载
onMounted(() => {
  fetchData()
})
</script>
