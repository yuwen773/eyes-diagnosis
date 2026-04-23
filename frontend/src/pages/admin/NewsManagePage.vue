<template>
  <a-form class="searchForm" layout="inline" :model="searchParams" @finish="doSearch">
    <a-form-item label="新闻标题">
      <a-input v-model:value="searchParams.title" placeholder="输入新闻标题" />
    </a-form-item>
    <a-form-item label="发布时间">
      <a-input v-model:value="searchParams.summary" placeholder="输入摘要" />
    </a-form-item>
    <a-form-item>
      <a-button type="primary" html-type="submit">搜索</a-button>
    </a-form-item>
    <a-form-item>
        <a-button type="primary" @click="editNews(null)">新增新闻</a-button>
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
      <template v-if="column.dataIndex === 'newsContent'">
        <div v-html="record.newsContent"></div>
      </template>
      <template v-else-if="column.dataIndex === 'publishTime'">
        {{ dayjs(record.publishTime).format('YYYY-MM-DD HH:mm:ss') }}
      </template>
      <template v-else-if="column.dataIndex === 'author'">
        {{ record.author}}
      </template>
      <template v-else-if="column.key === 'action'">
        <div class="editable-row-operations">
          <span>
              <a-button @click="editNews(record.id)">编辑</a-button>
          </span>
          <span>
            <a-button danger @click="doDelete(record.id)">删除</a-button>
          </span>
        </div>
      </template>
    </template>
  </a-table>
</template>

<script lang="ts" setup>
import { SmileOutlined } from '@ant-design/icons-vue';
import { computed, onMounted, reactive, ref} from 'vue'
import {
  deleteNews,
  listNewsVoByPage,
  listNewsVoByPageWithCache
} from '@/api/newsController'
import { message } from 'ant-design-vue'
import dayjs from 'dayjs'
import { useRouter } from 'vue-router';

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
    title:'作者',
    dataIndex: 'author',
  },
  {
    title: '操作',
    key: 'action',
  },
]

//数据
const dataList = ref<API.NewsVO[]>([])
const total = ref(0)
//搜索条件
const searchParams = reactive<API.NewsQueryDTO>({
  current: 1,
  pageSize: 10,

})

//获取数据
const fetchData = async () => {
  const res = await listNewsVoByPageWithCache({
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
//删除新闻
const doDelete = async (id: string) => {
  if (!id) {
    return
  }
  const res = await deleteNews({ id })
  if (res.data.code === 0) {
    message.success("删除成功")
    //刷新数据
    fetchData()
  } else {
    message.error('删除失败')
  }
}
const router = useRouter();

const editNews = async (id) => {
  router.push({
    path: `/news/edit/${id}`,
  });
}
//钩子函数 挂载时自动加载
onMounted(() => {
  fetchData()
})
</script>

<style scoped>
.searchForm {
  margin-left: 15px;
  margin-top: 15px;
}
</style>
