<template>
  <a-layout-footer class="global-footer">
    <!-- Organic wave separator — the signature moment -->
    <div class="footer-wave" aria-hidden="true">
      <svg viewBox="0 0 1440 80" preserveAspectRatio="none" class="wave-svg">
        <path d="M0,40 C240,80 480,0 720,40 C960,80 1200,0 1440,40 L1440,80 L0,80 Z" fill="currentColor" />
      </svg>
    </div>

    <!-- Background warmth -->
    <div class="footer-atmosphere" aria-hidden="true"></div>

    <!-- Main content -->
    <div class="footer-inner">
      <!-- Brand section — the emotional anchor -->
      <div class="footer-brand-section">
        <RouterLink to="/" class="footer-brand">
          <div class="brand-mark">
            <img src="../assets/eyesight-logo.svg" alt="EyeSight" class="brand-logo" />
          </div>
          <div class="brand-identity">
            <span class="brand-name">EyeSight</span>
            <span class="brand-en">Smart Eye Diagnosis</span>
          </div>
        </RouterLink>
        <p class="brand-tagline">
          让每一双眼睛都被温柔以待
        </p>
        <div class="brand-decoration" aria-hidden="true">
          <span class="decoration-line"></span>
        </div>
      </div>

      <!-- Navigation -->
      <nav class="footer-nav" aria-label="底部导航">
        <div class="nav-group">
          <span class="nav-group-label">探索</span>
          <RouterLink to="/" class="nav-link">
            <HomeOutlined />
            <span>首页</span>
          </RouterLink>
          <RouterLink to="/diagnosis" class="nav-link">
            <ScanOutlined />
            <span>开始诊断</span>
          </RouterLink>
          <RouterLink to="/news" class="nav-link">
            <FileTextOutlined />
            <span>资讯中心</span>
          </RouterLink>
        </div>

        <div class="nav-group">
          <span class="nav-group-label">账户</span>
          <RouterLink to="/user/userCenter/profile" class="nav-link">
            <UserOutlined />
            <span>个人中心</span>
          </RouterLink>
          <RouterLink to="/user/userCenter/diagnosisHistory" class="nav-link">
            <HistoryOutlined />
            <span>诊断历史</span>
          </RouterLink>
          <RouterLink to="/user/userCenter/notification" class="nav-link">
            <BellOutlined />
            <span>通知中心</span>
          </RouterLink>
        </div>

        <div class="nav-group">
          <span class="nav-group-label">关于</span>
          <a href="https://lyf1210.top" target="_blank" rel="noopener noreferrer" class="nav-link">
            <GlobalOutlined />
            <span>关于作者</span>
          </a>
          <a href="https://github.com/lyf1210" target="_blank" rel="noopener noreferrer" class="nav-link">
            <GithubOutlined />
            <span>GitHub</span>
          </a>
        </div>
      </nav>
    </div>

    <!-- Bottom bar -->
    <div class="footer-bottom">
      <div class="footer-bottom-inner">
        <div class="system-status">
          <span class="status-dot"></span>
          <span class="status-text">系统运行正常</span>
        </div>
        <div class="footer-meta">
          <span class="version-tag">v1.0.0</span>
          <span class="meta-sep"></span>
          <span class="copyright">© {{ currentYear }} YuWen</span>
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
/* ─── Footer container ─── */
.global-footer {
  position: relative;
  background: oklch(0.14 0.015 50);
  color: oklch(0.85 0.005 80);
  overflow: hidden;
  padding: 0 !important;
}

/* ─── Wave separator ─── */
.footer-wave {
  position: relative;
  margin-top: -2px;
  line-height: 0;
  color: var(--claude-bg-page, oklch(0.95 0.008 80));
}

.wave-svg {
  width: 100%;
  height: 60px;
  display: block;
}

/* ─── Warm atmosphere ─── */
.footer-atmosphere {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      ellipse 50% 60% at 20% 40%,
      oklch(0.55 0.08 30 / 0.06) 0%,
      transparent 100%
    ),
    radial-gradient(
      ellipse 40% 50% at 80% 60%,
      oklch(0.5 0.06 35 / 0.04) 0%,
      transparent 100%
    );
  pointer-events: none;
}

/* ─── Main content ─── */
.footer-inner {
  max-width: 1280px;
  margin: 0 auto;
  padding: 56px 40px 48px;
  display: grid;
  grid-template-columns: 1.1fr 1.9fr;
  gap: 64px;
  position: relative;
  z-index: 1;
}

/* ─── Brand section ─── */
.footer-brand-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.footer-brand {
  display: flex;
  align-items: center;
  gap: 14px;
  text-decoration: none;
  width: fit-content;
}

.brand-mark {
  position: relative;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background: oklch(0.55 0.08 30 / 0.15);
  transition: background 0.3s ease;
}

.footer-brand:hover .brand-mark {
  background: oklch(0.55 0.08 30 / 0.25);
}

.brand-logo {
  height: 32px;
  width: auto;
  filter: brightness(0) invert(1);
  opacity: 0.9;
}

.brand-identity {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.brand-name {
  font-family: var(--claude-font-serif);
  font-size: 22px;
  font-weight: 700;
  color: oklch(0.95 0.005 80);
  letter-spacing: 3px;
  line-height: 1.2;
}

.brand-en {
  font-family: var(--claude-font-sans);
  font-size: 10px;
  color: oklch(0.5 0.015 60);
  letter-spacing: 3.5px;
  text-transform: uppercase;
  font-weight: 500;
}

.brand-tagline {
  font-family: var(--claude-font-serif);
  font-size: 17px;
  font-weight: 400;
  color: oklch(0.6 0.03 50);
  line-height: 1.7;
  margin: 0;
  max-width: 260px;
  font-style: italic;
}

.brand-decoration {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.decoration-line {
  width: 40px;
  height: 2px;
  background: linear-gradient(
    90deg,
    oklch(0.6 0.1 30 / 0.5),
    oklch(0.6 0.1 30 / 0.1)
  );
  border-radius: 1px;
}

/* ─── Navigation ─── */
.footer-nav {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 40px;
  align-self: start;
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.nav-group-label {
  font-size: 11px;
  font-weight: 700;
  color: oklch(0.45 0.02 55);
  letter-spacing: 3px;
  text-transform: uppercase;
  margin-bottom: 8px;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  font-size: 14px;
  color: oklch(0.62 0.015 60);
  text-decoration: none;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  width: fit-content;
}

.nav-link:hover {
  color: oklch(0.7 0.08 35);
  transform: translateX(6px);
}

.nav-link :deep(.anticon) {
  font-size: 14px;
  opacity: 0.5;
  transition: all 0.25s ease;
}

.nav-link:hover :deep(.anticon) {
  opacity: 1;
  color: oklch(0.7 0.08 35);
}

/* ─── Bottom bar ─── */
.footer-bottom {
  position: relative;
  z-index: 1;
}

.footer-bottom::before {
  content: '';
  position: absolute;
  top: 0;
  left: 40px;
  right: 40px;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    oklch(0.35 0.02 55 / 0.3) 20%,
    oklch(0.35 0.02 55 / 0.3) 80%,
    transparent
  );
}

.footer-bottom-inner {
  max-width: 1280px;
  margin: 0 auto;
  padding: 20px 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.system-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: oklch(0.72 0.16 145);
  box-shadow: 0 0 8px oklch(0.72 0.16 145 / 0.5);
  animation: breathe 3s ease-in-out infinite;
}

@keyframes breathe {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(0.85); }
}

.status-text {
  font-size: 12px;
  color: oklch(0.5 0.015 55);
  font-weight: 500;
  letter-spacing: 0.3px;
}

.footer-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.version-tag {
  font-family: var(--claude-font-mono);
  font-size: 11px;
  color: oklch(0.4 0.015 55);
  padding: 3px 10px;
  background: oklch(0.2 0.015 55 / 0.5);
  border-radius: 6px;
  letter-spacing: 0.5px;
}

.meta-sep {
  width: 1px;
  height: 12px;
  background: oklch(0.3 0.015 55 / 0.5);
}

.copyright {
  font-size: 12px;
  color: oklch(0.4 0.015 55);
  letter-spacing: 0.3px;
}

/* ─── Responsive ─── */
@media (max-width: 1024px) {
  .footer-inner {
    grid-template-columns: 1fr;
    gap: 40px;
    padding: 48px 32px 40px;
  }

  .footer-nav {
    grid-template-columns: repeat(3, 1fr);
    gap: 28px;
  }

  .brand-tagline {
    max-width: none;
  }
}

@media (max-width: 768px) {
  .wave-svg {
    height: 40px;
  }

  .footer-inner {
    padding: 40px 24px 32px;
  }

  .footer-nav {
    grid-template-columns: repeat(2, 1fr);
  }

  .footer-bottom-inner {
    flex-direction: column;
    gap: 12px;
    padding: 16px 24px;
    align-items: flex-start;
  }

  .footer-bottom::before {
    left: 24px;
    right: 24px;
  }
}

@media (max-width: 480px) {
  .footer-inner {
    padding: 32px 20px 24px;
  }

  .footer-nav {
    grid-template-columns: 1fr;
    gap: 24px;
  }

  .brand-name {
    font-size: 18px;
  }

  .brand-mark {
    width: 40px;
    height: 40px;
  }

  .brand-logo {
    height: 26px;
  }
}
</style>
