<script lang="ts" setup>
import { reactive, ref } from 'vue'
import { UserOutlined, LockOutlined, ArrowRightOutlined } from '@ant-design/icons-vue'
import { userRegister } from '@/api/userController'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import type { Rule } from 'ant-design-vue/es/form'

const router = useRouter()
const loading = ref(false)

const formState = reactive({
  userAccount: '',
  userPassword: '',
  checkPassword: '',
})

const validatePasswordMatch = async (_rule: Rule, value: string) => {
  if (value !== formState.userPassword) {
    return Promise.reject('两次输入的密码不一致')
  }
  return Promise.resolve()
}

const handleSubmit = async (values: any) => {
  loading.value = true
  try {
    const res = await userRegister(values)
    if (res.data.code === 0 && res.data.data) {
      message.success('注册成功')
      router.push({ path: '/user/login', replace: true })
    } else {
      message.error('注册失败: ' + res.data.msg)
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="register-page">
    <!-- 左侧 KPI 仪表板 -->
    <aside class="register-dashboard" aria-label="平台指标">
      <div class="dash-header">
        <RouterLink to="/" class="brand-mark">
          <span class="brand-name">Iris</span>
          <span class="brand-tag">CLINICAL EDITORIAL · v2.3.1</span>
        </RouterLink>
      </div>

      <div class="dash-section">
        <span class="dash-overline">ACCOUNT · 注册即享</span>
        <div class="kpi-row">
          <div class="kpi">
            <span class="kpi-label">免费额度</span>
            <span class="kpi-value">50<span class="kpi-unit">次/月</span></span>
            <span class="kpi-trend">注册即开通</span>
          </div>
          <div class="kpi">
            <span class="kpi-label">模型版本</span>
            <span class="kpi-value">v2.3.1<span class="kpi-unit">最新</span></span>
            <span class="kpi-trend">↑ 本月更新</span>
          </div>
        </div>
        <div class="kpi-row">
          <div class="kpi">
            <span class="kpi-label">数据加密</span>
            <span class="kpi-value">AES-256<span class="kpi-unit">位</span></span>
            <span class="kpi-trend flat">→ 端到端</span>
          </div>
          <div class="kpi">
            <span class="kpi-label">服务可用</span>
            <span class="kpi-value">99.9<span class="kpi-unit">%</span></span>
            <span class="kpi-trend">↑ 7×24</span>
          </div>
        </div>
      </div>

      <div class="dash-section">
        <span class="dash-overline">WORKFLOW · 4 步上手</span>
        <ol class="step-list">
          <li class="step-item">
            <span class="step-num">01</span>
            <span class="step-name">创建账号</span>
            <span class="step-time">~30s</span>
          </li>
          <li class="step-item">
            <span class="step-num">02</span>
            <span class="step-name">上传眼底图</span>
            <span class="step-time">~10s</span>
          </li>
          <li class="step-item">
            <span class="step-num">03</span>
            <span class="step-name">获取诊断报告</span>
            <span class="step-time">~8s</span>
          </li>
          <li class="step-item">
            <span class="step-num">04</span>
            <span class="step-name">AI 深度问诊</span>
            <span class="step-time">按需</span>
          </li>
        </ol>
      </div>

      <div class="dash-foot">
        <span class="foot-meta">注册即同意《用户协议》与《隐私政策》</span>
      </div>
    </aside>

    <!-- 右侧注册卡 -->
    <main class="register-form-wrap">
      <div class="register-card">
        <div class="card-accent" aria-hidden="true"></div>
        <header class="card-header">
          <span class="card-overline">REGISTER · 注册</span>
          <h1 class="card-title">创建账号 · 即刻可用</h1>
          <p class="card-subtitle">注册后即可使用全部诊断功能，无需信用卡</p>
        </header>

        <a-form
          :model="formState"
          name="register"
          autocomplete="off"
          @finish="handleSubmit"
          class="register-form"
        >
          <a-form-item
            name="userAccount"
            :rules="[{ required: true, message: '请输入账号' }]"
          >
            <a-input
              v-model:value="formState.userAccount"
              placeholder="请输入账号（4-16位字母数字）"
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
              placeholder="请输入密码（至少8位）"
              size="large"
            >
              <template #prefix>
                <LockOutlined class="input-icon" />
              </template>
            </a-input-password>
          </a-form-item>

          <a-form-item
            name="checkPassword"
            :rules="[
              { required: true, message: '请确认密码' },
              { min: 8, message: '密码不能小于8位' },
              { validator: validatePasswordMatch }
            ]"
          >
            <a-input-password
              v-model:value="formState.checkPassword"
              placeholder="请再次输入密码"
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
              注册
              <ArrowRightOutlined v-if="!loading" />
            </a-button>
          </a-form-item>
        </a-form>

        <footer class="card-footer">
          <span class="footer-text">已有账号？</span>
          <RouterLink to="/user/login" class="footer-link">立即登录</RouterLink>
        </footer>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* ════════════════════════════════════════════
   仪表盘式 · 方向 B
   ════════════════════════════════════════════ */
.register-page {
  display: flex;
  min-height: 100vh;
  background: var(--iris-bg);
}
::selection { background: var(--iris-accent-soft); color: var(--iris-ink); }
button:focus-visible, a:focus-visible, input:focus-visible {
  outline: none;
  box-shadow: var(--iris-focus-ring);
}

.register-dashboard {
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
}
.kpi-value {
  font-family: var(--iris-font-mono);
  font-size: 22px;
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

.step-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0; border: 1px solid var(--iris-line); border-radius: 6px; overflow: hidden; }
.step-item {
  display: grid;
  grid-template-columns: 32px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  font-size: 12px;
  background: var(--iris-surface);
  border-bottom: 1px solid var(--iris-line);
  transition: background 150ms;
}
.step-item:last-child { border-bottom: none; }
.step-item:hover { background: var(--iris-surface-2); }
.step-num {
  font-family: var(--iris-font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--iris-accent);
  letter-spacing: 0.5px;
}
.step-name {
  font-family: var(--iris-font-sans);
  color: var(--iris-ink);
  font-weight: 500;
}
.step-time {
  font-family: var(--iris-font-mono);
  font-size: 11px;
  color: var(--iris-ink-3);
  font-variant-numeric: tabular-nums;
}

.dash-foot { margin-top: auto; padding-top: 16px; border-top: 1px solid var(--iris-line); }
.foot-meta {
  font-family: var(--iris-font-sans);
  font-size: 11px;
  color: var(--iris-ink-3);
  line-height: 1.5;
}

/* ═══ 右侧表单 ═══ */
.register-form-wrap {
  width: 480px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 32px;
  background: var(--iris-bg);
}
.register-card {
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
.card-header { margin-bottom: 24px; }
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

.register-form { margin-top: 4px; }
.register-form :deep(.ant-input-affix-wrapper) {
  padding: 8px 14px;
  border-radius: 6px;
  border-color: var(--iris-line);
  background: var(--iris-surface);
  transition: border-color 200ms var(--iris-transition-fast), box-shadow 200ms var(--iris-transition-fast);
}
.register-form :deep(.ant-input-affix-wrapper:hover) { border-color: var(--iris-line-strong); }
.register-form :deep(.ant-input-affix-wrapper-focused) {
  border-color: var(--iris-accent);
  box-shadow: 0 0 0 3px var(--iris-accent-soft);
}
.register-form :deep(.ant-input) { font-size: 14px; }
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

@media (max-width: 1024px) {
  .register-dashboard { padding: 32px; }
  .kpi-value { font-size: 18px; }
}
@media (max-width: 860px) {
  .register-page { flex-direction: column-reverse; }
  .register-dashboard { flex: none; border-right: none; border-bottom: 1px solid var(--iris-line); padding: 24px; gap: 20px; }
  .register-form-wrap { width: 100%; padding: 24px; }
  .kpi-row { grid-template-columns: repeat(4, 1fr); }
  .dash-section:nth-of-type(2) { display: none; }
}
@media (max-width: 600px) {
  .kpi-row { grid-template-columns: 1fr 1fr; }
  .brand-name { font-size: 20px; }
  .card-title { font-size: 20px; }
  .register-card { padding: 28px 24px; }
}
</style>
