<script lang="ts" setup>
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router';
import {
  UserOutlined,
  ArrowLeftOutlined,
  ReadOutlined,
} from '@ant-design/icons-vue';
import { MdPreview } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';
import { message } from 'ant-design-vue';
import { getNewsVo } from '@/api/newsController';

interface TocItem {
  id: string;
  text: string;
  level: number;
}

const route = useRoute();
const router = useRouter();
const news = ref<API.NewsVO | null>(null);
const isLoaded = ref(false);
const activeSection = ref<string>('');
const tocItems = ref<TocItem[]>([]);
const contentRef = ref<HTMLElement | null>(null);

const formatDateShort = (dateString?: string) => {
  if (!dateString) return '';
  return new Date(dateString).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).replace(/\//g, '.');
};

const parseToc = (content: string) => {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const items: TocItem[] = [];
  let match;

  while ((match = headingRegex.exec(content)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    const id = text
      .toLowerCase()
      .replace(/[^一-龥a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    items.push({ id, text, level });
  }

  return items;
};

const updateActiveSection = () => {
  if (!contentRef.value) return;

  const headings = contentRef.value.querySelectorAll('h2, h3');
  const scrollTop = window.scrollY + 120;

  let current = '';
  headings.forEach((heading) => {
    const rect = heading.getBoundingClientRect();
    const top = rect.top + window.scrollY;

    if (scrollTop >= top) {
      current = heading.id;
    }
  });

  if (current && current !== activeSection.value) {
    activeSection.value = current;
  }
};

const scrollToSection = (id: string) => {
  const element = document.getElementById(id);
  if (element) {
    const top = element.getBoundingClientRect().top + window.scrollY - 100;
    window.scrollTo({ top, behavior: 'smooth' });
  }
};

const fetchNews = async () => {
  try {
    const res = await getNewsVo({
      id: Number(route.params.id),
    });
    if (res.data.code === 0 && res.data.data) {
      news.value = res.data.data;
      tocItems.value = parseToc(res.data.data.content || '');
      setTimeout(() => {
        isLoaded.value = true;
        nextTick(() => {
          if (contentRef.value) {
            const headings = contentRef.value.querySelectorAll('h2, h3');
            headings.forEach((heading, index) => {
              if (tocItems.value[index]) {
                heading.id = tocItems.value[index].id;
              }
            });
          }
          updateActiveSection();
        });
      }, 50);
    } else {
      message.error('获取新闻详情失败: ' + res.data.msg);
      router.push('/news');
    }
  } catch (error) {
    message.error('加载新闻详情出错');
    console.error(error);
  }
};

const goBack = () => {
  isLoaded.value = false;
  setTimeout(() => {
    router.go(-1);
  }, 200);
};

onMounted(() => {
  fetchNews();
  window.addEventListener('scroll', updateActiveSection, { passive: true });
});

onUnmounted(() => {
  window.removeEventListener('scroll', updateActiveSection);
});
</script>

<template>
  <article class="news-detail" :class="{ 'is-loaded': isLoaded }">
    <!-- Back Navigation -->
    <nav class="back-nav">
      <button class="back-btn" @click="goBack">
        <span class="back-arrow">
          <arrow-left-outlined />
        </span>
        <span class="back-text">返回列表</span>
      </button>
    </nav>

    <template v-if="news">
      <!-- Hero Section -->
      <header class="article-hero">
        <div v-if="news.coverImage" class="hero-image-wrapper">
          <img :src="news.coverImage" :alt="news.title" class="hero-image" />
          <div class="hero-gradient"></div>
          <div class="hero-vignette"></div>
        </div>
        <div class="hero-content">
          <div class="article-badge">
            <read-outlined />
            <span>健康资讯</span>
          </div>
          <h1 class="article-title">{{ news.title }}</h1>
          <div class="article-meta-row">
            <div class="author-block">
              <div class="author-avatar">
                <user-outlined />
              </div>
              <div class="author-info">
                <span class="author-name">{{ news.author }}</span>
                <span class="author-label">作者</span>
              </div>
            </div>
            <div class="meta-divider"></div>
            <div class="publish-info">
              <span class="publish-date">{{ formatDateShort(news.publishTime) }}</span>
              <span class="publish-label">发布时间</span>
            </div>
          </div>
        </div>
      </header>

      <!-- Article Body with Sidebar TOC -->
      <div class="article-layout">
        <!-- Fixed Sidebar TOC -->
        <aside v-if="tocItems.length > 0" class="toc-sidebar">
          <div class="toc-sticky">
            <div class="toc-header">
              <span class="toc-label">目录</span>
            </div>
            <nav class="toc-nav">
              <button
                v-for="item in tocItems"
                :key="item.id"
                class="toc-item"
                :class="{
                  'is-active': activeSection === item.id,
                  'is-h3': item.level === 3
                }"
                @click="scrollToSection(item.id)"
              >
                <span class="toc-marker"></span>
                <span class="toc-text">{{ item.text }}</span>
              </button>
            </nav>
          </div>
        </aside>

        <!-- Main Content -->
        <div class="article-body-wrapper">
          <div class="article-content" ref="contentRef">
            <div v-if="news.summary" class="article-lead">
              <div class="lead-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <path d="M4 4h16v16H4V4z" stroke="currentColor" stroke-width="1.5"/>
                  <path d="M4 4l8 8M20 4l-8 8" stroke="currentColor" stroke-width="1.5"/>
                </svg>
              </div>
              <p class="lead-text">{{ news.summary }}</p>
            </div>
            <div class="markdown-content">
              <MdPreview
                :modelValue="news.content"
                :editorId="'news-preview'"
                :previewOnly="true"
                :noMermaid="true"
                :noKatex="true"
              />
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Loading State -->
    <div v-else class="loading-state">
      <div class="loading-skeleton hero-skeleton"></div>
      <div class="loading-skeleton title-skeleton"></div>
      <div class="loading-skeleton meta-skeleton"></div>
    </div>
  </article>
</template>

<style scoped>
.news-detail {
  min-height: 100vh;
  background: var(--claude-bg-page);
  overflow-x: hidden;
}

/* ─── Back Navigation ─── */
.back-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 50;
  padding: 1.25rem 2rem;
  background: linear-gradient(
    to bottom,
    var(--claude-bg-page) 0%,
    var(--claude-bg-page) 60%,
    transparent 100%
  );
  max-width: 100%;
  margin: 0 auto;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--claude-bg-elevated);
  border: none;
  font-size: 0.85rem;
  color: var(--claude-text-secondary);
  cursor: pointer;
  padding: 0.5rem 1rem;
  border-radius: var(--claude-radius-xl);
  box-shadow: var(--claude-shadow-sm);
  transition:
    transform var(--claude-transition-fast),
    box-shadow var(--claude-transition-fast);
}

.back-btn:hover {
  transform: translateX(-4px);
  box-shadow: var(--claude-shadow-md);
}

.back-btn:hover .back-arrow {
  color: var(--claude-brand);
}

.back-arrow {
  display: flex;
  transition: color var(--claude-transition-fast);
}

.back-text {
  font-weight: 500;
}

/* ─── Article Layout with Sidebar ─── */
.article-layout {
  display: flex;
  justify-content: center;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 2rem;
  gap: 4rem;
}

/* ─── Sidebar TOC ─── */
.toc-sidebar {
  width: 220px;
  flex-shrink: 0;
  padding-top: 4rem;
}

.toc-sticky {
  position: sticky;
  top: 100px;
}

.toc-header {
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--claude-border-cream);
}

.toc-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--claude-text-tertiary);
}

.toc-nav {
  display: flex;
  flex-direction: column;
}

.toc-item {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  width: 100%;
  padding: 0.5rem 0;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  transition: all var(--claude-transition-fast);
}

.toc-item:hover .toc-text {
  color: var(--claude-brand);
}

.toc-item.is-h3 {
  padding-left: 1rem;
}

.toc-item.is-active .toc-text {
  color: var(--claude-brand);
  font-weight: 600;
}

.toc-marker {
  width: 8px;
  height: 8px;
  margin-top: 0.4rem;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--claude-border-warm);
  transition: all var(--claude-transition-fast);
}

.toc-item.is-active .toc-marker {
  background: var(--claude-brand);
  box-shadow: 0 0 0 3px oklch(0.35 0.12 25 / 0.15);
}

.toc-text {
  font-size: 0.85rem;
  color: var(--claude-text-secondary);
  line-height: 1.5;
  transition: color var(--claude-transition-fast);
}

/* ─── Main Content ─── */
.article-body-wrapper {
  flex: 1;
  max-width: 720px;
  padding: 4rem 0 5rem;
  min-width: 0;
}

.article-content {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.6s ease-out 0.4s, transform 0.6s ease-out 0.4s;
}

.news-detail.is-loaded .article-content {
  opacity: 1;
  transform: translateY(0);
}

/* ─── Hero Section ─── */
.article-hero {
  position: relative;
  min-height: 70vh;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.hero-image-wrapper {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.hero-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scale(1.05);
  transition: transform 8s ease-out;
}

.news-detail.is-loaded .hero-image {
  transform: scale(1);
}

.hero-gradient {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to top,
    var(--claude-bg-page) 0%,
    oklch(0.15 0.01 70 / 0.7) 40%,
    oklch(0.15 0.01 70 / 0.3) 70%,
    transparent 100%
  );
}

.hero-vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse at center,
    transparent 0%,
    oklch(0.15 0.01 70 / 0.2) 100%
  );
}

.hero-content {
  position: relative;
  max-width: 900px;
  margin: 0 auto;
  padding: 0 2rem 4rem;
  width: 100%;
}

/* Article Badge */
.article-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: var(--claude-brand);
  color: var(--claude-text-inverse);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 0.35rem 0.75rem;
  border-radius: var(--claude-radius-sm);
  margin-bottom: 1.5rem;
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.6s ease-out, transform 0.6s ease-out;
}

.news-detail.is-loaded .article-badge {
  opacity: 1;
  transform: translateY(0);
}

/* Article Title */
.article-title {
  font-family: var(--claude-font-serif);
  font-size: clamp(2.2rem, 6vw, 4rem);
  font-weight: 700;
  color: var(--claude-text-inverse);
  line-height: 1.1;
  margin: 0 0 2rem;
  max-width: 15ch;
  text-shadow: 0 2px 20px rgba(0, 0, 0, 0.3);
  opacity: 0;
  transform: translateY(30px);
  transition: opacity 0.7s ease-out 0.1s, transform 0.7s ease-out 0.1s;
}

.news-detail.is-loaded .article-title {
  opacity: 1;
  transform: translateY(0);
}

/* Meta Row */
.article-meta-row {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.6s ease-out 0.25s, transform 0.6s ease-out 0.25s;
}

.news-detail.is-loaded .article-meta-row {
  opacity: 1;
  transform: translateY(0);
}

.author-block {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.author-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--claude-brand);
  color: var(--claude-text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
}

.author-info {
  display: flex;
  flex-direction: column;
}

.author-name {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--claude-text-inverse);
}

.author-label {
  font-size: 0.7rem;
  color: oklch(1 0 0 / 0.6);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.meta-divider {
  width: 1px;
  height: 32px;
  background: oklch(1 0 0 / 0.2);
}

.publish-info {
  display: flex;
  flex-direction: column;
}

.publish-date {
  font-family: var(--claude-font-mono);
  font-size: 0.95rem;
  color: var(--claude-text-inverse);
  font-weight: 500;
}

.publish-label {
  font-size: 0.7rem;
  color: oklch(1 0 0 / 0.6);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* ─── Article Lead ─── */
.article-lead {
  position: relative;
  padding: 1.5rem 1.5rem 1.5rem 2rem;
  margin-bottom: 2.5rem;
  background: var(--claude-bg-card);
  border-radius: var(--claude-radius-xl);
  box-shadow: var(--claude-shadow-md);
}

.lead-icon {
  position: absolute;
  top: -10px;
  left: 1.25rem;
  width: 36px;
  height: 36px;
  background: var(--claude-brand);
  color: var(--claude-text-inverse);
  border-radius: var(--claude-radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
}

.lead-icon svg {
  width: 18px;
  height: 18px;
}

.lead-text {
  font-family: var(--claude-font-serif);
  font-size: 1.15rem;
  line-height: 1.7;
  color: var(--claude-text-primary);
  font-weight: 400;
  margin: 0;
}

/* ─── Loading State ─── */
.loading-state {
  padding: 8rem 2rem;
  max-width: 760px;
  margin: 0 auto;
}

.loading-skeleton {
  background: linear-gradient(
    90deg,
    var(--claude-border-cream) 0%,
    var(--claude-bg-elevated) 50%,
    var(--claude-border-cream) 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: var(--claude-radius-md);
}

.hero-skeleton {
  height: 50vh;
  margin-bottom: 2rem;
  border-radius: var(--claude-radius-lg);
}

.title-skeleton {
  height: 3rem;
  width: 80%;
  margin-bottom: 1rem;
}

.meta-skeleton {
  height: 1.5rem;
  width: 40%;
}

@keyframes shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

/* ─── Responsive ─── */
@media (max-width: 1024px) {
  .article-layout {
    gap: 2.5rem;
  }

  .toc-sidebar {
    width: 180px;
  }
}

@media (max-width: 768px) {
  .back-nav {
    padding: 1rem;
  }

  .article-layout {
    flex-direction: column;
    padding: 0 1.25rem;
    gap: 0;
  }

  .toc-sidebar {
    display: none;
  }

  .article-body-wrapper {
    padding: 2.5rem 0 4rem;
  }

  .hero-content {
    padding: 0 1.25rem 3rem;
  }

  .article-title {
    max-width: none;
  }

  .article-meta-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
  }

  .meta-divider {
    display: none;
  }

  .lead-text {
    font-size: 1.05rem;
  }

  .article-lead {
    padding: 1.25rem 1.25rem 1.25rem 1.75rem;
  }

  .lead-icon {
    left: 0.875rem;
  }
}
</style>

<!-- Global markdown style overrides -->
<style>
/* MdPreview internal background fix - make it transparent to inherit page background */
.news-detail .markdown-content .md-editor {
  background: transparent !important;
}

.news-detail .markdown-content .md-editor-preview {
  background: transparent !important;
}

.news-detail .markdown-content table {
  border-collapse: collapse;
  width: 100%;
  margin: 2rem 0;
  font-size: 0.95rem;
}

.news-detail .markdown-content th,
.news-detail .markdown-content td {
  border: 1px solid var(--claude-border-warm);
  padding: 0.75rem 1rem;
  text-align: left;
}

.news-detail .markdown-content th {
  background: var(--claude-bg-card);
  font-weight: 600;
  font-family: var(--claude-font-serif);
}

.news-detail .markdown-content tbody tr:hover {
  background: oklch(0.98 0.01 70 / 0.5);
}

/* Blockquote with brand accent */
.news-detail .markdown-content blockquote {
  position: relative;
  background: oklch(0.97 0.02 70 / 0.6);
  border-radius: 0 var(--claude-radius-lg) var(--claude-radius-lg) 0;
  padding: 1.5rem 1.5rem 1.5rem 2.5rem;
  margin: 2.5rem 0;
  color: var(--claude-text-secondary);
  border: none;
}

.news-detail .markdown-content blockquote::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: var(--claude-brand);
  border-radius: var(--claude-radius-sm) 0 0 var(--claude-radius-sm);
}

.news-detail .markdown-content blockquote p:last-child {
  margin-bottom: 0;
}

.news-detail .markdown-content blockquote p {
  margin-bottom: 0.75em;
  line-height: 1.7;
}

/* Code blocks with brand accent */
.news-detail .markdown-content pre {
  position: relative;
  background: var(--claude-bg-card);
  padding: 1.5rem;
  border-radius: var(--claude-radius-lg);
  overflow-x: auto;
  border: 1px solid var(--claude-border-cream);
  margin: 2rem 0;
}

.news-detail .markdown-content pre::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--claude-brand), var(--claude-brand-light));
  border-radius: var(--claude-radius-lg) var(--claude-radius-lg) 0 0;
}

.news-detail .markdown-content code {
  font-size: 0.9em;
  font-family: var(--claude-font-mono);
}

.news-detail .markdown-content code:not(pre code) {
  background: oklch(0.95 0.01 70 / 0.5);
  padding: 0.15em 0.4em;
  border-radius: var(--claude-radius-sm);
  color: var(--claude-brand-dark);
}

.news-detail .markdown-content img {
  display: block;
  max-width: 100%;
  border-radius: var(--claude-radius-lg);
  margin: 2.5rem auto;
  box-shadow: var(--claude-shadow-lg);
}

.news-detail .markdown-content p {
  margin-bottom: 1.25em;
  line-height: 1.85;
  font-size: 1rem;
}

/* Headings with decorative markers */
.news-detail .markdown-content h2,
.news-detail .markdown-content h3,
.news-detail .markdown-content h4 {
  font-family: var(--claude-font-serif);
  color: var(--claude-text-primary);
  line-height: 1.3;
  position: relative;
}

.news-detail .markdown-content h2 {
  font-size: 1.5rem;
  font-weight: 700;
  margin-top: 3rem;
  margin-bottom: 1.25rem;
  padding-bottom: 0.75rem;
  border-bottom: 2px solid var(--claude-border-cream);
}

.news-detail .markdown-content h3 {
  font-size: 1.2rem;
  font-weight: 600;
  margin-top: 2rem;
  margin-bottom: 0.875rem;
}

.news-detail .markdown-content h3::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  background: var(--claude-brand);
  border-radius: 50%;
  margin-right: 0.5rem;
  vertical-align: middle;
  margin-bottom: 2px;
}

.news-detail .markdown-content h4 {
  font-size: 1.05rem;
  font-weight: 600;
  margin-top: 1.5rem;
  margin-bottom: 0.75rem;
}

.news-detail .markdown-content a {
  color: var(--claude-brand);
  text-decoration: none;
  font-weight: 500;
  border-bottom: 1px solid transparent;
  transition: border-color var(--claude-transition-fast);
}

.news-detail .markdown-content a:hover {
  border-bottom-color: var(--claude-brand);
}

.news-detail .markdown-content ul,
.news-detail .markdown-content ol {
  padding-left: 1.5rem;
  margin: 1.25rem 0;
}

.news-detail .markdown-content li {
  margin-bottom: 0.5rem;
  line-height: 1.7;
}

.news-detail .markdown-content li::marker {
  color: var(--claude-brand);
}

.news-detail .markdown-content hr {
  border: none;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--claude-border-warm), transparent);
  margin: 3rem 0;
}

/* Strong and emphasis */
.news-detail .markdown-content strong {
  font-weight: 600;
  color: var(--claude-text-primary);
}

.news-detail .markdown-content em {
  font-style: italic;
  color: var(--claude-text-secondary);
}
</style>
