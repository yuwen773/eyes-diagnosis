<template>
  <a-layout-footer class="global-footer">
    <!-- 背景装饰层 -->
    <div class="footer-glow" aria-hidden="true"></div>
    <div class="footer-grid-pattern" aria-hidden="true"></div>

    <!-- 主内容 -->
    <div class="footer-inner">
      <!-- 左侧：品牌 + 描述 -->
      <div class="footer-brand-section">
        <RouterLink to="/" class="footer-brand">
          <div class="footer-logo-wrapper">
            <img src="../assets/logo.png" alt="logo" class="footer-logo" />
            <div class="footer-logo-glow"></div>
          </div>
          <div class="footer-brand-text">
            <span class="footer-brand-name">明眸智诊</span>
            <span class="footer-brand-en">Eye Diagnosis AI</span>
          </div>
        </RouterLink>
        <p class="footer-tagline">
          智能眼底诊断 · 让每一双眼睛都被温柔以待
        </p>
      </div>

      <!-- 中间：导航 + 链接 -->
      <nav class="footer-nav-section" aria-label="底部导航">
        <div class="footer-nav-group">
          <span class="footer-nav-label">探索</span>
          <RouterLink to="/" class="footer-link">
            <HomeOutlined />
            <span>首页</span>
          </RouterLink>
          <RouterLink to="/diagnosis" class="footer-link">
            <ScanOutlined />
            <span>开始诊断</span>
          </RouterLink>
          <RouterLink to="/news" class="footer-link">
            <FileTextOutlined />
            <span>资讯中心</span>
          </RouterLink>
        </div>

        <div class="footer-nav-group">
          <span class="footer-nav-label">账户</span>
          <RouterLink to="/user/userCenter/profile" class="footer-link">
            <UserOutlined />
            <span>个人中心</span>
          </RouterLink>
          <RouterLink to="/user/userCenter/diagnosisHistory" class="footer-link">
            <HistoryOutlined />
            <span>诊断历史</span>
          </RouterLink>
          <RouterLink to="/user/userCenter/notification" class="footer-link">
            <BellOutlined />
            <span>通知中心</span>
          </RouterLink>
        </div>

        <div class="footer-nav-group">
          <span class="footer-nav-label">关于</span>
          <a href="https://lyf1210.top" target="_blank" rel="noopener noreferrer" class="footer-link">
            <GlobalOutlined />
            <span>关于作者</span>
          </a>
          <a href="https://github.com/lyf1210" target="_blank" rel="noopener noreferrer" class="footer-link">
            <GithubOutlined />
            <span>GitHub</span>
          </a>
        </div>
      </nav>
    </div>

    <!-- 底部：版本 + 版权 -->
    <div class="footer-bottom">
      <div class="footer-bottom-inner">
        <div class="footer-status">
          <span class="footer-status-dot"></span>
          <span class="footer-status-text">系统运行正常</span>
        </div>
        <div class="footer-info">
          <span class="footer-version">v1.0.0</span>
          <span class="footer-divider">·</span>
          <span class="footer-copyright">© {{ currentYear }} YuWen. All rights reserved.</span>
        </div>
      </div>
    </div>
  </a-layout-footer>
</template>

<script setup lang="ts">
import {
  HomeOutlined,
  UserOutlined,
  GlobalOutlined,
  ScanOutlined,
  FileTextOutlined,
  HistoryOutlined,
  BellOutlined,
  GithubOutlined
} from '@ant-design/icons-vue'

const currentYear = new Date().getFullYear()
</script>

<style scoped>
/* ─── 基础布局 ─── */
.global-footer {
  background: var(--claude-bg-deep);
  position: relative;
  overflow: hidden;
}

/* ─── 背景装饰 ─── */
.footer-glow {
  position: absolute;
  top: -60px;
  left: 50%;
  transform: translateX(-50%);
  width: 600px;
  height: 120px;
  background: radial-gradient(
    ellipse at center,
    rgba(201, 100, 66, 0.15) 0%,
    rgba(201, 100, 66, 0.05) 40%,
    transparent 70%
  );
  pointer-events: none;
}

.footer-grid-pattern {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(250, 249, 245, 0.02) 1px, transparent 1px),
    linear-gradient(90deg, rgba(250, 249, 245, 0.02) 1px, transparent 1px);
  background-size: 40px 40px;
  pointer-events: none;
}

/* ─── 主内容区 ─── */
.footer-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 48px 40px 40px;
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 60px;
  position: relative;
  z-index: 1;
}

/* ─── 品牌区 ─── */
.footer-brand-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.footer-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
  width: fit-content;
}

.footer-logo-wrapper {
  position: relative;
  display: flex;
}

.footer-logo {
  height: 36px;
  width: auto;
  filter: brightness(0) invert(1);
  opacity: 0.9;
  transition: all 0.3s ease;
}

.footer-logo-glow {
  position: absolute;
  inset: -4px;
  background: radial-gradient(
    circle at center,
    rgba(201, 100, 66, 0.3) 0%,
    transparent 70%
  );
  border-radius: 50%;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.footer-brand:hover .footer-logo {
  opacity: 1;
  transform: scale(1.05);
}

.footer-brand:hover .footer-logo-glow {
  opacity: 1;
}

.footer-brand-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.footer-brand-name {
  font-family: var(--claude-font-serif);
  font-size: 18px;
  font-weight: 600;
  color: var(--claude-text-inverse);
  letter-spacing: 2px;
  line-height: 1.2;
}

.footer-brand-en {
  font-family: var(--claude-font-sans);
  font-size: 10px;
  color: rgba(250, 249, 245, 0.4);
  letter-spacing: 3px;
  text-transform: uppercase;
}

.footer-tagline {
  font-size: 13px;
  color: rgba(250, 249, 245, 0.35);
  line-height: 1.6;
  margin: 0;
  max-width: 240px;
}

/* ─── 导航区 ─── */
.footer-nav-section {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 32px;
}

.footer-nav-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.footer-nav-label {
  font-size: 11px;
  font-weight: 600;
  color: rgba(250, 249, 245, 0.3);
  letter-spacing: 2px;
  text-transform: uppercase;
  margin-bottom: 4px;
}

.footer-link {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  font-size: 14px;
  color: rgba(250, 249, 245, 0.55);
  text-decoration: none;
  transition: all 0.2s ease;
  width: fit-content;
}

.footer-link:hover {
  color: var(--claude-brand-light);
  transform: translateX(4px);
}

.footer-link :deep(.anticon) {
  font-size: 13px;
  opacity: 0.7;
  transition: all 0.2s ease;
}

.footer-link:hover :deep(.anticon) {
  opacity: 1;
  color: var(--claude-brand-light);
}

/* ─── 底部状态栏 ─── */
.footer-bottom {
  border-top: 1px solid rgba(250, 249, 245, 0.06);
  position: relative;
  z-index: 1;
}

.footer-bottom-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.footer-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.footer-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--claude-success);
  box-shadow: 0 0 8px var(--claude-success);
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.footer-status-text {
  font-size: 12px;
  color: rgba(250, 249, 245, 0.35);
}

.footer-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.footer-version {
  font-family: var(--claude-font-mono);
  font-size: 11px;
  color: rgba(250, 249, 245, 0.25);
  padding: 2px 8px;
  border: 1px solid rgba(250, 249, 245, 0.1);
  border-radius: 4px;
  letter-spacing: 0.5px;
}

.footer-divider {
  color: rgba(250, 249, 245, 0.15);
}

.footer-copyright {
  font-size: 12px;
  color: rgba(250, 249, 245, 0.3);
  letter-spacing: 0.3px;
}

/* ─── 响应式 ─── */
@media (max-width: 1024px) {
  .footer-inner {
    grid-template-columns: 1fr;
    gap: 40px;
    padding: 40px 32px 32px;
  }

  .footer-nav-section {
    grid-template-columns: repeat(3, 1fr);
    gap: 24px;
  }

  .footer-tagline {
    max-width: none;
  }
}

@media (max-width: 768px) {
  .footer-nav-section {
    grid-template-columns: repeat(2, 1fr);
  }

  .footer-bottom-inner {
    flex-direction: column;
    gap: 12px;
    padding: 16px 24px;
  }
}

@media (max-width: 480px) {
  .footer-inner {
    padding: 32px 20px 24px;
  }

  .footer-nav-section {
    grid-template-columns: 1fr;
    gap: 24px;
  }

  .footer-brand-name {
    font-size: 16px;
  }

  .footer-logo {
    height: 28px;
  }
}
</style>
