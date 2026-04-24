<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useLoginUserStore } from '@/stores/user'

const props = defineProps<{
  placement?: 'bottom-end' | 'bottom-start'
}>()

const emit = defineEmits<{
  (e: 'logout'): void
}>()

const loginUserStore = useLoginUserStore()
const router = useRouter()
const isOpen = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)

const user = computed(() => loginUserStore.loginUser)
const isAdmin = computed(() => user.value?.userRole === 'admin')

const toggleDropdown = () => {
  isOpen.value = !isOpen.value
}

const closeDropdown = () => {
  isOpen.value = false
}

const handleClickOutside = (event: MouseEvent) => {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    closeDropdown()
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})

const goCenter = () => {
  closeDropdown()
  router.push('/user/userCenter')
}

const goAdmin = () => {
  closeDropdown()
  router.push('/admin/dashboard')
}

const doLogout = async () => {
  closeDropdown()
  emit('logout')
}
</script>

<template>
  <div ref="dropdownRef" class="relative inline-block">
    <!-- 头像触发器 -->
    <button
      @click.stop="toggleDropdown"
      class="flex items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c96442] rounded-full"
      aria-label="用户菜单"
    >
      <img
        v-if="user?.userAvatar"
        :src="user.userAvatar"
        :alt="user.userName ?? '头像'"
        class="w-[42px] h-[42px] rounded-full object-cover ring-2 ring-transparent hover:ring-[#c96442] transition-all duration-200"
      />
      <div
        v-else
        class="w-[42px] h-[42px] rounded-full bg-[#c96442] flex items-center justify-center text-[#faf9f5] text-base font-medium"
      >
        {{ user?.userName?.charAt(0) ?? '游' }}
      </div>
    </button>

    <!-- 下拉菜单 -->
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 scale-95 -translate-y-1"
      enter-to-class="opacity-100 scale-100 translate-y-0"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="opacity-100 scale-100 translate-y-0"
      leave-to-class="opacity-0 scale-95 -translate-y-1"
    >
      <div
        v-show="isOpen"
        :class="[
          'absolute right-0 mt-3 w-60 rounded-xl bg-[#30302e] shadow-lg',
          'ring-1 ring-[#30302e] z-[200]',
          placement === 'bottom-start' ? 'left-0' : 'right-0'
        ]"
      >
        <!-- 用户信息区 -->
        <div class="px-4 py-4 border-b border-[#3d3d3a]">
          <div class="flex items-center gap-3">
            <img
              v-if="user?.userAvatar"
              :src="user.userAvatar"
              :alt="user.userName ?? '头像'"
              class="w-10 h-10 rounded-full object-cover"
            />
            <div
              v-else
              class="w-10 h-10 rounded-full bg-[#c96442] flex items-center justify-center text-[#faf9f5] font-medium"
            >
              {{ user?.userName?.charAt(0) ?? '游' }}
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-[#faf9f5] font-medium text-[15px] truncate">
                {{ user?.userName ?? '未登录' }}
              </p>
              <p v-if="isAdmin" class="text-[#b0aea5] text-xs mt-0.5">
                管理员
              </p>
            </div>
          </div>
        </div>

        <!-- 菜单项 -->
        <div class="py-2">
          <!-- 个人中心 -->
          <button
            @click="goCenter"
            class="w-full flex items-center gap-3 px-4 py-3 text-[15px] text-[#faf9f5] hover:bg-[#c96442] transition-colors duration-150 rounded-lg mx-2 my-0.5"
          >
            <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            个人中心
          </button>

          <!-- 系统管理 (仅 admin) -->
          <button
            v-if="isAdmin"
            @click="goAdmin"
            class="w-full flex items-center gap-3 px-4 py-3 text-[15px] text-[#faf9f5] hover:bg-[#c96442] transition-colors duration-150 rounded-lg mx-2 my-0.5"
          >
            <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            系统管理
          </button>
        </div>

        <!-- 分隔线 -->
        <div class="border-t border-[#3d3d3a] mx-4 my-2"></div>

        <!-- 退出登录 -->
        <div class="pb-2">
          <button
            @click="doLogout"
            class="w-full flex items-center gap-3 px-4 py-3 text-[15px] text-[#d97757] hover:bg-[#c96442] hover:text-[#faf9f5] transition-colors duration-150 rounded-lg mx-2 my-0.5"
          >
            <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            退出登录
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>
