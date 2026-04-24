<template>
  <div class="profile-container">
    <a-page-header title="个人资料">
      <template #extra>
        <a-button type="primary" class="edit-btn" @click="goToEdit">
          编辑资料
        </a-button>
      </template>
    </a-page-header>

    <div class="stats-grid">
      <StatCard :value="stats.totalDiagnoses" label="总诊断数" />
      <StatCard :value="stats.pendingReexamine" label="待复诊" />
      <StatCard :value="stats.completed" label="已完成" />
      <StatCard :value="stats.reexamineRate" label="复诊率" suffix="%" />
    </div>

    <a-descriptions bordered :column="2" class="profile-info">
      <a-descriptions-item label="姓名">{{ loginUser.userName }}</a-descriptions-item>
      <a-descriptions-item label="性别">{{ renderGender }}</a-descriptions-item>
<!--      <a-descriptions-item label="年龄">{{ loginUser?.age || '******' }}</a-descriptions-item>-->
      <a-descriptions-item label="手机号">{{ loginUser?.phone || '******' }}</a-descriptions-item>
      <a-descriptions-item label="邮箱">{{ loginUser?.email || '******'}}</a-descriptions-item>
      <a-descriptions-item label="注册时间">{{
        dayjs(Number(loginUser.createTime)).format('YYYY-MM-DD')
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
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/userCenter'
import { useLoginUserStore } from '@/stores/user'
import dayjs from 'dayjs'
import StatCard from '@/components/user/StatCard.vue'

const router = useRouter()

const goToEdit = () => {
  router.push('/user/userCenter/accountSettings')
}

interface DiagnosisStats {
  totalDiagnoses: number
  pendingReexamine: number
  completed: number
  reexamineRate: number
}

const stats = ref<DiagnosisStats>({
  totalDiagnoses: 156,
  pendingReexamine: 12,
  completed: 144,
  reexamineRate: 92.3
})
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
  padding: var(--space-6);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.edit-btn {
  background-color: #c96442;
  border-color: #c96442;
  color: #fff;
}

.edit-btn:hover {
  background-color: #b55a3a;
  border-color: #b55a3a;
  color: #fff;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-4);
  margin-top: var(--space-4);
}

.profile-info {
  margin-top: var(--space-6);
  color: var(--color-text);
}

:deep(.ant-descriptions-item-label) {
  color: var(--color-text-secondary);
}

:deep(.ant-card) {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
}
</style>
