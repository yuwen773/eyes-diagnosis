<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useLoginUserStore } from '@/stores/user'

defineProps<{
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
  <div ref="dropdownRef" class="avatar-dropdown">
    <!-- Trigger button -->
    <button
      @click.stop="toggleDropdown"
      class="avatar-dropdown__trigger"
      aria-label="用户菜单"
    >
      <img
        v-if="user?.userAvatar"
        :src="user.userAvatar"
        :alt="user.userName ?? '头像'"
        class="avatar-dropdown__avatar"
      />
      <div
        v-else
        class="avatar-dropdown__avatar-placeholder"
      >
        {{ user?.userName?.charAt(0) ?? '游' }}
      </div>
    </button>

    <!-- Dropdown menu -->
    <Transition
      enter-active-class="avatar-dropdown__panel--enter-active"
      enter-from-class="avatar-dropdown__panel--enter-from"
      enter-to-class="avatar-dropdown__panel--enter-to"
      leave-active-class="avatar-dropdown__panel--leave-active"
      leave-from-class="avatar-dropdown__panel--leave-from"
      leave-to-class="avatar-dropdown__panel--leave-to"
    >
      <div
        v-show="isOpen"
        class="avatar-dropdown__panel"
        :class="{
          'avatar-dropdown__panel--start': placement === 'bottom-start'
        }"
      >
        <!-- User info section -->
        <div class="avatar-dropdown__user-info">
          <div class="avatar-dropdown__user-row">
            <img
              v-if="user?.userAvatar"
              :src="user.userAvatar"
              :alt="user.userName ?? '头像'"
              class="avatar-dropdown__user-avatar"
            />
            <div
              v-else
              class="avatar-dropdown__user-avatar-placeholder"
            >
              {{ user?.userName?.charAt(0) ?? '游' }}
            </div>
            <div class="avatar-dropdown__user-detail">
              <p class="avatar-dropdown__user-name">
                {{ user?.userName ?? '未登录' }}
              </p>
              <span
                v-if="isAdmin"
                class="avatar-dropdown__badge"
              >
                管理员
              </span>
            </div>
          </div>
        </div>

        <!-- Menu items -->
        <div class="avatar-dropdown__menu">
          <!-- Profile center -->
          <button
            @click="goCenter"
            class="avatar-dropdown__menu-item"
          >
            <svg class="avatar-dropdown__menu-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            个人中心
          </button>

          <!-- System admin (admin only) -->
          <button
            v-if="isAdmin"
            @click="goAdmin"
            class="avatar-dropdown__menu-item"
          >
            <svg class="avatar-dropdown__menu-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            系统管理
          </button>
        </div>

        <!-- Divider -->
        <div class="avatar-dropdown__divider"></div>

        <!-- Logout -->
        <div class="avatar-dropdown__logout-section">
          <button
            @click="doLogout"
            class="avatar-dropdown__logout-btn"
          >
            <svg class="avatar-dropdown__menu-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            退出登录
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.avatar-dropdown {
  position: relative;
  display: inline-block;
}

/* Trigger button */
.avatar-dropdown__trigger {
  display: flex;
  align-items: center;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  outline: none;
  border-radius: 50%;
}

.avatar-dropdown__trigger:focus-visible {
  outline: 2px solid var(--claude-brand);
  outline-offset: 2px;
}

/* Main avatar in trigger */
.avatar-dropdown__avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid transparent;
  transition: border-color 0.2s ease;
}

.avatar-dropdown__avatar:hover {
  border-color: var(--claude-brand);
}

.avatar-dropdown__avatar-placeholder {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: var(--claude-brand);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 500;
  font-size: 16px;
}

/* Dropdown panel */
.avatar-dropdown__panel {
  position: absolute;
  right: 0;
  margin-top: 12px;
  width: 240px;
  border-radius: 12px;
  background: var(--claude-bg-dark);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 200;
}

.avatar-dropdown__panel--start {
  left: 0;
  right: auto;
}

/* Transition classes */
.avatar-dropdown__panel--enter-active {
  transition: all 0.2s ease-out;
}
.avatar-dropdown__panel--enter-from {
  opacity: 0;
  transform: scale(0.95) translateY(-4px);
}
.avatar-dropdown__panel--enter-to {
  opacity: 1;
  transform: scale(1) translateY(0);
}
.avatar-dropdown__panel--leave-active {
  transition: all 0.15s ease-in;
}
.avatar-dropdown__panel--leave-from {
  opacity: 1;
  transform: scale(1) translateY(0);
}
.avatar-dropdown__panel--leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(-4px);
}

/* User info section */
.avatar-dropdown__user-info {
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.avatar-dropdown__user-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar-dropdown__user-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid rgba(255, 255, 255, 0.2);
  flex-shrink: 0;
}

.avatar-dropdown__user-avatar-placeholder {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--claude-brand);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 500;
  font-size: 15px;
  flex-shrink: 0;
}

.avatar-dropdown__user-detail {
  flex: 1;
  min-width: 0;
}

.avatar-dropdown__user-name {
  color: #fff;
  font-weight: 500;
  font-size: 15px;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.avatar-dropdown__badge {
  display: inline-block;
  margin-top: 2px;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 500;
  color: #fff;
  background: var(--claude-brand);
  border-radius: 4px;
}

/* Menu section */
.avatar-dropdown__menu {
  padding: 6px 8px;
}

.avatar-dropdown__menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  font-size: 14px;
  color: #fff;
  background: none;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.15s ease;
  text-align: left;
}

.avatar-dropdown__menu-item:hover {
  background: var(--claude-brand);
  border-radius: 8px;
}

.avatar-dropdown__menu-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

/* Divider */
.avatar-dropdown__divider {
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  margin: 0 16px 4px;
}

/* Logout section */
.avatar-dropdown__logout-section {
  padding: 0 8px 6px;
}

.avatar-dropdown__logout-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  font-size: 14px;
  color: var(--claude-brand-light);
  background: none;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
}

.avatar-dropdown__logout-btn:hover {
  background: var(--claude-brand);
  color: #fff;
}
</style>
