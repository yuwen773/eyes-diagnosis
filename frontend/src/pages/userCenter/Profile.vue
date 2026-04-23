<template>
  <div class="profile-container">
    <a-page-header title="个人资料" />

    <a-descriptions bordered :column="2" class="profile-info">
      <a-descriptions-item label="姓名">{{ loginUser.userName }}</a-descriptions-item>
      <a-descriptions-item label="性别">{{ renderGender }}</a-descriptions-item>
<!--      <a-descriptions-item label="年龄">{{ loginUser?.age || '******' }}</a-descriptions-item>-->
      <a-descriptions-item label="手机号">{{ loginUser?.phone || '******' }}</a-descriptions-item>
      <a-descriptions-item label="邮箱">{{ loginUser?.email || '******'}}</a-descriptions-item>
      <a-descriptions-item label="注册时间">{{
        dayjs(loginUser.createTime).format('YYYY-MM-DD')
        }}</a-descriptions-item>
      <a-descriptions-item label="角色">
        <a-tag :color="loginUser.userRole === 'admin' ? 'blue' : 'green'">
          {{ loginUser.userRole === 'admin' ? '管理员' : '用户' }}
        </a-tag>
      </a-descriptions-item>
    </a-descriptions>
    <a-card title="用户简介" :bordered="false" style="width: 1360px;height: 250px">
      {{loginUser?.userProfile ||"这个用户很懒，什么都没有留下"}}
    </a-card>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { useUserStore } from '@/stores/userCenter'
import { useLoginUserStore } from '@/stores/user'
import dayjs from 'dayjs'
interface UserInfo {
  id: string
  name: string
  avatar: string
  gender: string
  age: number
  phone: string
  email: string
  role: 'doctor' | 'patient'
  registerTime: string
}
// const userStore = useUserStore()
// const userInfo = computed(() => userStore.userInfo)

const loginUserStore = useLoginUserStore()
const loginUser = loginUserStore.loginUser

const renderGender = computed(()=>{
  if(loginUser?.gender === 1){
    return '男'
  }else{
    return '女';
  }
})

</script>

<style scoped>
.profile-container {
  padding: 24px;
  background: #fff;
  border-radius: 4px;
}

.profile-info {
  margin-top: 24px;
}
</style>
