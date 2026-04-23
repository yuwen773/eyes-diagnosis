<template>
  <a-form class="searchForm" layout="inline" :model="searchParams" @finish="doSearch">
    <a-form-item label="账号">
      <a-input v-model:value="searchParams.userAccount" placeholder="输入账号"  />
    </a-form-item>
    <a-form-item label="用户名">
      <a-input v-model:value="searchParams.userName" placeholder="输入用户名"  />
    </a-form-item>
    <a-form-item >
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
    <template #bodyCell="{ column,text, record }">
      <template v-if="column.dataIndex === 'userAvatar'">
        <a-image :src="record.userAvatar" :width="120" />
      </template>
      <template v-else-if="column.dataIndex === 'userRole'">
        <div v-if="record.userRole === 'admin'">
          <a-tag color="green">管理员</a-tag>
        </div>

        <div v-else>
          <a-tag color="blue">普通用户</a-tag>
        </div>
      </template>
      <template v-else-if="column.dataIndex === 'createTime'">
        {{ dayjs(record.createTime).format('YYYY-MM-DD HH:mm:ss') }}
      </template>

      <template v-else-if="column.key === 'action'">
        <div class="editable-row-operations">
<!--          <span v-if="editableData[record.id]">
            <a-typography-link @click="save(record.id)">Save</a-typography-link>
            <a-popconfirm title="Sure to cancel?" @confirm="cancel(record.id)">
              <a>Cancel</a>
            </a-popconfirm>
          </span>
          <span v-else>
             <a-button  @click="edit(record.id)">Edit</a-button>
          </span>-->
          <span>
        <a-button danger @click="doDelete(record.id)">删除</a-button>
          </span>
        </div>
      </template>
    </template>

  </a-table>
</template>

<script lang="ts" setup>
import { SmileOutlined, DownOutlined } from '@ant-design/icons-vue';
import { computed, onMounted, reactive, ref, type UnwrapRef } from 'vue'
import {
  deleteUser,
  listUserVoByPage,
  listUserVoByPageWithCache
} from '@/api/userController'
import { message } from 'ant-design-vue'
import dayjs from 'dayjs'
import wrapperRaf from 'ant-design-vue/es/_util/raf'
import cancel = wrapperRaf.cancel
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

//数据
const dataList = ref<API.UserVO[]>([])
const total = ref(0)
//搜索条件
const searchParams = reactive<API.UserQueryDTO>({
  current: 1,
  pageSize: 10,
})

//获取数据
const fetchData = async ()=>{
  const res = await listUserVoByPageWithCache({
    ...searchParams
  })
  if(res.data.data ){
    dataList.value = res.data.data.records ??  []
    total.value = res.data.data.total ?? 0
  }else{
    message.error('获取数据失败'+res.data.msg)
  }
}

//分页参数
const pagination = computed(()=>{
  return {
    current:searchParams.current ?? 1, //有则按照传过来的，否则默认为1
    pageSize:searchParams.pageSize ?? 10,//默认为 10
    total:Number(total.value )?? 0,//默认为 0
    showSizeChanger:true,
    showTotal:((total) => `共${total}条数据`),
  }
})
// 分页参数变化时的监视
const doTableChange = (page:any)=>{
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
//删除用户
const doDelete = async(id:string) =>{
  if(userLogin.loginUser.userRole === 'admin'){
    message.error("无法操作管理员")
    return
  }
  if(!id){
    return
  }
  const res = await deleteUser({id})
  if(res.data.code === 0 ){
    message.success("删除成功")
    //刷新数据
    fetchData()
  }
  else{
    message.error('删除失败')
  }
}
//编辑数据
// const editableData: UnwrapRef<Record<string, API.UserVO>> = reactive({});
//
// const edit = (id: string) => {
//   editableData[id] = cloneDeep(dataList.value.filter(item => id === item.id)[0]);
// };
// const save = (id: string) => {
//   Object.assign(dataList.value.filter(item => id === item.id)[0], editableData[id]);
//   delete editableData[id];
// };
// const cancel = (id: string) => {
//   delete editableData[id];
// };



//钩子函数 挂载时自动加载
onMounted(()=>{
  fetchData()
})

</script>

<style scoped>
.searchForm {
  margin-left: 15px;
  margin-top: 15px;
}
</style>
