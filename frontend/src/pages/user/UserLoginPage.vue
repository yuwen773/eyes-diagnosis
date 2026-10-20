<script lang="ts" setup>
import { reactive, ref } from 'vue'
import { UserOutlined, LockOutlined, ArrowRightOutlined } from '@ant-design/icons-vue'
import { userLogin } from '@/api/userController'
import { useRouter } from 'vue-router'
import { useLoginUserStore } from '@/stores/user'
import { message } from 'ant-design-vue'

const router = useRouter()
const userLoginStore = useLoginUserStore()
const loading = ref(false)

const formState = reactive<API.UserLoginDTO>({
  userAccount: '',
  userPassword: '',
})

const handleSubmit = async (values: any) => {
  loading.value = true
  try {
    const res = await userLogin(values)
    if (res.data.code === 0 && res.data.data) {
      await userLoginStore.fetchLoginUser()
      message.success('登录成功')
      const loginUser = userLoginStore.loginUser
      if (loginUser?.userRole === 'admin') {
        router.push({ path: '/admin/dashboard', replace: true })
      } else {
        router.push({ path: '/', replace: true })
      }
    } else {
      message.error('登录失败: ' + res.data.msg)
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <!-- 左侧 KPI 仪表板（仪表盘式：工具陈列关系） -->
    <aside class="login-dashboard" aria-label="平台指标">
      <div class="dash-header">
        <RouterLink to="/" class="brand-mark">
          <span class="brand-name">眼瞳 Iris</span>
          <span class="brand-tag">CLINICAL EDITORIAL · v2.3.1</span>
        </RouterLink>
      </div>

      <div class="dash-section">
        <span class="dash-overline">PLATFORM · 平台指标</span>
        <div class="kpi-row">
          <div class="kpi">
            <span class="kpi-label">累计诊断</span>
            <span class="kpi-value">5,632<span class="kpi-unit">例</span></span>
            <span class="kpi-trend">↑ +12.5%</span>
          </div>
          <div class="kpi">
            <span class="kpi-label">活跃用户</span>
            <span class="kpi-value">1,284<span class="kpi-unit">人</span></span>
            <span class="kpi-trend">↑ +4.2%</span>
          </div>
        </div>
        <div class="kpi-row">
          <div class="kpi">
            <span class="kpi-label">模型准确率</span>
            <span class="kpi-value">96.3<span class="kpi-unit">%</span></span>
            <span class="kpi-trend flat">→ 持平</span>
          </div>
          <div class="kpi">
            <span class="kpi-label">诊断耗时</span>
            <span class="kpi-value">8.4<span class="kpi-unit">s</span></span>
            <span class="kpi-trend">↓ -1.2s</span>
          </div>
        </div>
      </div>

      <div class="dash-section">
        <span class="dash-overline">SEVERITY · 风险分布</span>
        <div class="risk-list">
          <div class="risk-row" data-sev="high">
            <span class="risk-label">高风险</span>
            <span class="risk-bar"><span class="risk-fill" style="width: 8%"></span></span>
            <span class="risk-count">12</span>
          </div>
          <div class="risk-row" data-sev="mod">
            <span class="risk-label">中风险</span>
            <span class="risk-bar"><span class="risk-fill" style="width: 24%"></span></span>
            <span class="risk-count">87</span>
          </div>
          <div class="risk-row" data-sev="low">
            <span class="risk-label">低风险</span>
            <span class="risk-bar"><span class="risk-fill" style="width: 68%"></span></span>
            <span class="risk-count">5,533</span>
          </div>
        </div>
      </div>

      <div class="dash-foot">
        <span class="foot-meta">数据更新于 09:42 · 自动刷新</span>
      </div>
    </aside>

    <!-- 右侧登录卡 -->
    <main class="login-form-wrap">
      <div class="login-card">
        <div class="card-accent" aria-hidden="true"></div>
        <header class="card-header">
          <span class="card-overline">SIGN IN · 登录</span>
          <h1 class="card-title">继续你的诊断之旅</h1>
          <p class="card-subtitle">用你的账号登录眼瞳 Iris，开始 AI 辅助诊断</p>
        </header>

        <a-form
          :model="formState"
          name="login"
          autocomplete="off"
          @finish="handleSubmit"
          class="login-form"
        >
          <a-form-item
            name="userAccount"
            :rules="[{ required: true, message: '请输入账号' }]"
          >
            <a-input
              v-model:value="formState.userAccount"
              placeholder="请输入账号"
              size="large"
            >
              <template #prefix>
                <UserOutlined class="input-icon" />
              </template>
            </a-input>
          </a-form-item>

          <a-form-item
            name="userPassword"
            :rules="[
              { required: true, message: '请输入密码' },
              { min: 8, message: '密码不能小于8位' }
            ]"
          >
            <a-input-password
              v-model:value="formState.userPassword"
              placeholder="请输入密码"
              size="large"
            >
              <template #prefix>
                <LockOutlined class="input-icon" />
              </template>
            </a-input-password>
          </a-form-item>

          <a-form-item>
            <a-button
              type="primary"
              html-type="submit"
              size="large"
              :loading="loading"
              class="submit-btn"
              block
            >
              登录
              <ArrowRightOutlined v-if="!loading" />
            </a-button>
          </a-form-item>
        </a-form>

        <footer class="card-footer">
          <span class="footer-text">还没有账号？</span>
          <RouterLink to="/user/register" class="footer-link">立即注册</RouterLink>
        </footer>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* ════════════════════════════════════════════
   仪表盘式 · 方向 B
   - 左侧 KPI 仪表板（工具陈列关系）
   - 右侧表单（克制数据流）
   - 衬线 500-600，sans 主导，mono 给数据
   ════════════════════════════════════════════ */
.login-page {
  display: flex;
  min-height: 100vh;
  background: var(--iris-bg);
}

::selection { background: var(--iris-accent-soft); color: var(--iris-ink); }

button:focus-visible,
a:focus-visible,
input:focus-visible {
  outline: none;
  box-shadow: var(--iris-focus-ring);
}

/* ═══ 左侧 KPI 仪表 ═══ */
.login-dashboard {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--iris-surface);
  border-right: 1px solid var(--iris-line);
  padding: 40px 48px;
  gap: 36px;
  min-width: 0;
}

.dash-header { padding-bottom: 24px; border-bottom: 1px solid var(--iris-line); }
.brand-mark {
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-decoration: none;
  width: fit-content;
}
.brand-name {
  font-family: var(--iris-font-serif);
  font-size: 22px;
  font-weight: 600;
  color: var(--iris-ink);
  letter-spacing: 1px;
  line-height: 1.1;
}
.brand-tag {
  font-family: var(--iris-font-mono);
  font-size: 10px;
  font-weight: 500;
  color: var(--iris-ink-3);
  letter-spacing: 1.2px;
}

.dash-section { display: flex; flex-direction: column; gap: 14px; }
.dash-overline {
  font-family: var(--iris-font-mono);
  font-size: 10px;
  font-weight: 600;
  color: var(--iris-ink-3);
  letter-spacing: 1.5px;
  text-transform: uppercase;
}

.kpi-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.kpi {
  background: var(--iris-surface-2);
  border: 1px solid var(--iris-line);
  border-radius: 6px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.kpi:hover { background: var(--iris-bg); }
.kpi-label {
  font-family: var(--iris-font-sans);
  font-size: 11px;
  font-weight: 500;
  color: var(--iris-ink-2);
  letter-spacing: 0.3px;
}
.kpi-value {
  font-family: var(--iris-font-mono);
  font-size: 24px;
  font-weight: 600;
  color: var(--iris-ink);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.015em;
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.kpi-unit {
  font-family: var(--iris-font-sans);
  font-size: 11px;
  font-weight: 400;
  color: var(--iris-ink-3);
}
.kpi-trend {
  font-family: var(--iris-font-mono);
  font-size: 11px;
  font-weight: 500;
  color: var(--iris-sev-low);
  font-variant-numeric: tabular-nums;
}
.kpi-trend.flat { color: var(--iris-ink-3); }

.risk-list { display: flex; flex-direction: column; gap: 10px; }
.risk-row {
  display: grid;
  grid-template-columns: 64px 1fr 40px;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}
.risk-label {
  font-family: var(--iris-font-sans);
  color: var(--iris-ink-2);
  font-weight: 500;
}
.risk-bar {
  height: 8px;
  background: var(--iris-surface-2);
  border: 1px solid var(--iris-line);
  border-radius: 4px;
  overflow: hidden;
}
.risk-fill { display: block; height: 100%; border-radius: 4px; transition: width 500ms var(--iris-transition-base); }
.risk-row[data-sev='high'] .risk-fill { background: var(--iris-sev-high); }
.risk-row[data-sev='mod'] .risk-fill { background: var(--iris-sev-moderate); }
.risk-row[data-sev='low'] .risk-fill { background: var(--iris-sev-low); }
.risk-count {
  font-family: var(--iris-font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--iris-ink);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.dash-foot { margin-top: auto; padding-top: 16px; border-top: 1px solid var(--iris-line); }
.foot-meta {
  font-family: var(--iris-font-mono);
  font-size: 10px;
  color: var(--iris-ink-3);
  letter-spacing: 0.5px;
}

/* ═══ 右侧表单 ═══ */
.login-form-wrap {
  width: 480px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 32px;
  background: var(--iris-bg);
}
.login-card {
  width: 100%;
  max-width: 400px;
  position: relative;
  background: var(--iris-surface);
  border: 1px solid var(--iris-line);
  border-radius: 8px;
  padding: 36px 32px;
  box-shadow:
    0 1px 2px rgba(22, 20, 15, 0.04),
    0 4px 12px rgba(22, 20, 15, 0.05);
}
.card-accent {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: var(--iris-accent);
  border-radius: 8px 8px 0 0;
}
.card-header { margin-bottom: 28px; }
.card-overline {
  display: inline-block;
  font-family: var(--iris-font-mono);
  font-size: 10px;
  font-weight: 600;
  color: var(--iris-accent);
  letter-spacing: 1.5px;
  margin-bottom: 12px;
}
.card-title {
  font-family: var(--iris-font-serif);
  font-size: 22px;
  font-weight: 600;
  color: var(--iris-ink);
  margin: 0 0 6px 0;
  line-height: 1.3;
  letter-spacing: -0.01em;
}
.card-subtitle {
  font-size: 13px;
  color: var(--iris-ink-2);
  margin: 0;
  line-height: 1.6;
}

.login-form { margin-top: 4px; }
.login-form :deep(.ant-input-affix-wrapper) {
  padding: 8px 14px;
  border-radius: 6px;
  border-color: var(--iris-line);
  background: var(--iris-surface);
  transition: border-color 200ms var(--iris-transition-fast), box-shadow 200ms var(--iris-transition-fast);
}
.login-form :deep(.ant-input-affix-wrapper:hover) { border-color: var(--iris-line-strong); }
.login-form :deep(.ant-input-affix-wrapper-focused) {
  border-color: var(--iris-accent);
  box-shadow: 0 0 0 3px var(--iris-accent-soft);
}
.login-form :deep(.ant-input) { font-size: 14px; }
.input-icon { color: var(--iris-ink-3); font-size: 14px; }
:deep(.ant-input-prefix) { margin-right: 8px; }

.submit-btn {
  height: 46px;
  font-size: 14px;
  font-weight: 600;
  border-radius: 6px;
  background: var(--iris-accent);
  border-color: var(--iris-accent);
  transition: all 200ms var(--iris-transition-base);
  letter-spacing: 0.01em;
}
.submit-btn:hover {
  background: var(--iris-accent-strong);
  border-color: var(--iris-accent-strong);
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(27, 127, 107, 0.22);
}

.card-footer {
  text-align: center;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--iris-line);
}
.footer-text { font-size: 13px; color: var(--iris-ink-2); }
.footer-link {
  font-size: 13px;
  color: var(--iris-accent);
  font-weight: 600;
  margin-left: 6px;
  text-decoration: none;
  transition: color 150ms;
}
.footer-link:hover { color: var(--iris-accent-strong); text-decoration: underline; }

/* ═══ 响应式 ═══ */
@media (max-width: 1024px) {
  .login-dashboard { padding: 32px; }
  .kpi-value { font-size: 20px; }
}
@media (max-width: 860px) {
  .login-page { flex-direction: column-reverse; }
  .login-dashboard { flex: none; border-right: none; border-bottom: 1px solid var(--iris-line); padding: 24px; gap: 20px; }
  .login-form-wrap { width: 100%; padding: 24px; }
  .kpi-row { grid-template-columns: repeat(4, 1fr); }
  .dash-section:last-of-type { display: none; }
}
@media (max-width: 600px) {
  .kpi-row { grid-template-columns: 1fr 1fr; }
  .brand-name { font-size: 20px; }
  .card-title { font-size: 20px; }
  .login-card { padding: 28px 24px; }
  .risk-row { grid-template-columns: 56px 1fr 36px; gap: 8px; }
  .risk-count { font-size: 11px; }
}
@media (max-width: 420px) {
  .kpi-row { grid-template-columns: 1fr; }
  .risk-row { grid-template-columns: 56px 1fr 36px; }
}
</style>
