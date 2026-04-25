<template>
  <div class="manage-page">
    <!-- 搜索区域 -->
    <div class="search-bar">
      <a-input
        v-model:value="searchParams.userAccount"
        placeholder="输入账号"
        allow-clear
        class="search-input"
        @press-enter="doSearch"
      />
      <a-input
        v-model:value="searchParams.userName"
        placeholder="输入用户名"
        allow-clear
        class="search-input"
        @press-enter="doSearch"
      />
      <a-button type="primary" @click="doSearch">搜索</a-button>
      <a-button @click="doReset">重置</a-button>
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
      <template v-if="column.dataIndex === 'userAvatar'">
        <a-avatar :src="record.userAvatar" />
      </template>
      <template v-else-if="column.dataIndex === 'userRole'">
        <a-tag :color="record.userRole === 'admin' ? 'green' : 'blue'">
          {{ record.userRole === 'admin' ? '管理员' : '普通用户' }}
        </a-tag>
      </template>
      <template v-else-if="column.dataIndex === 'createTime'">
        {{ dayjs(Number(record.createTime)).format('YYYY-MM-DD HH:mm:ss') }}
      </template>
      <template v-else-if="column.key === 'action'">
        <a-popconfirm title="确定删除该用户？" @confirm="doDelete(record.id)">
          <a-button danger>删除</a-button>
        </a-popconfirm>
      </template>
    </template>
  </a-table>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted, reactive, ref } from 'vue'
import {
  deleteUser,
  listUserVoByPageWithCache
} from '@/api/userController'
import { message } from 'ant-design-vue'
import dayjs from 'dayjs'
import { useLoginUserStore } from '@/stores/user'

const userLogin = useLoginUserStore()

// 字段
const columns = [
  {
    title: 'id',
    dataIndex: 'id',
  },
  {
    title: '账号',
    dataIndex: 'userAccount',
  },
  {
    title: '用户名',
    dataIndex: 'userName',
  },
  {
    title: '头像',
    dataIndex: 'userAvatar',
  },
  {
    title: '简介',
    dataIndex: 'userProfile',
  },
  {
    title: '用户角色',
    dataIndex: 'userRole',
  },
  {
    title: '创建时间',
    dataIndex: 'createTime',
  },
  {
    title: '操作',
    key: 'action',
  },
]

// 数据
const dataList = ref<API.UserVO[]>([])
const total = ref(0)
const loading = ref(false)

// 搜索条件
const searchParams = reactive<API.UserQueryDTO>({
  current: 1,
  pageSize: 10,
})

// 获取数据
const fetchData = async () => {
  loading.value = true
  try {
    const res = await listUserVoByPageWithCache({
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
    showTotal: (total: number) => `共${total}条数据`,
  }
})

// 分页参数变化时的回调
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

// 重置搜索条件并重新获取数据
const doReset = () => {
  searchParams.userAccount = undefined
  searchParams.userName = undefined
  searchParams.current = 1
  searchParams.pageSize = 10
  fetchData()
}

// 删除用户
const doDelete = async (id: string) => {
  if (userLogin.loginUser.userRole === 'admin') {
    message.error('无法操作管理员')
    return
  }
  if (!id) {
    return
  }
  const res = await deleteUser({ id: Number(id) })
  if (res.data.code === 0) {
    message.success('删除成功')
    fetchData()
  } else {
    message.error('删除失败')
  }
}

// 挂载时自动加载
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

.search-input {
  width: 160px;
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
