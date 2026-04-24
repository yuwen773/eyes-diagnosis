<script lang="ts" setup>

const sanitize = (html: string) => {
  return html.replace(/<img/g, '<img style="display:block;margin:0 auto"');
};
import { ref, onMounted, h } from 'vue'
import { useRoute, useRouter } from 'vue-router';
import {
  UserOutlined,
  CalendarOutlined,
  TagOutlined,
  ArrowLeftOutlined,
  UpCircleOutlined
} from '@ant-design/icons-vue';
import { MdPreview } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';
import { message } from 'ant-design-vue';
import { getNewsVo } from '@/api/newsController';

const route = useRoute();
const router = useRouter();
const news = ref<API.NewsVO | null>(null);

// 格式化日期
const formatDate = (dateString?: string) => {
  if (!dateString) return ''
  return new Date(dateString).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

// 获取新闻详情
const fetchNews = async () => {
  try {
    const res = await getNewsVo({
      id: Number(route.params.id)
    });


    if (res.data.code === 0 && res.data.data) {
      news.value = res.data.data;
    } else {
      message.error('获取新闻详情失败: ' + res.data.msg);
      router.push('/news');
    }
  } catch (error) {
    message.error('加载新闻详情出错');
    console.error(error);
  }
};
const showBackToTop = ref(false)
// 返回列表
const goBack = () => {
  router.go(-1);
};

onMounted(() => {
  fetchNews();
  window.addEventListener('scroll', handleScroll)
});
// 监听滚动位置，控制"返回顶部"按钮的显示
const handleScroll = () => {
  showBackToTop.value = window.pageYOffset > 300
}

const backToTop = () => {
  window.scrollTo({
    top: 0,
    behavior: 'smooth',
  })
}
</script>

<template>
  <a-page-header
    style="
    padding: 16px;
    border-bottom: 1px solid #f0f0f0;"
    title="新闻详情"
    @back="goBack"
  />
  <a-card title="新闻详情" class="detail-card">
    <div v-if="news">
      <div class="news-header">
        <h1>{{ news.title }}</h1>
        <div class="news-meta">
          <span class="meta-item">
            <user-outlined /> {{ news.author }}
          </span>
          <span class="meta-item">
            <calendar-outlined /> {{ formatDate(news.publishTime) }}
          </span>
          <span class="meta-item">
            <tag-outlined /> {{ news.summary || '未分类' }}
          </span>
        </div>
      </div>
      <!-- 封面图容器 -->
      <div class="cover-container">
        <a-image
          v-if="news.coverImage"
          :src="news.coverImage"
          class="news-cover"
          :preview="false"
        />
      </div>

      <!-- Markdown 内容 -->
      <div class="markdown-content">
        <MdPreview
          :modelValue="news.content"
          :editorId="'news-preview'"
          :previewOnly="true"
          :noMermaid="true"
          :noKatex="true"
          :sanitize="sanitize"
        />

      </div>

      <!-- 操作按钮 -->
      <div class="news-actions">
        <a-button @click="goBack" type="primary" ghost>
          <arrow-left-outlined /> 返回列表
        </a-button>
      </div>
    </div>

    <!-- 加载状态 -->
    <a-spin v-else size="large" class="loading-spin" />

    <!-- 返回顶部按钮 -->
    <a-affix :offsetBottom="80">
      <a-button
        class="toTop"
        type="primary"
        :icon="h(UpCircleOutlined)"
        v-show="showBackToTop"
        @click="backToTop"
      />
    </a-affix>
  </a-card>
</template>

<style scoped>
/* 全局Markdown图片样式 */
.markdown-content img {
  display: block;
  margin: 16px auto;
  max-width: 80%;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: transform 0.3s;
}

.markdown-content img:hover {
  transform: scale(1.02);
}

/* 响应式调整 */
@media (max-width: 768px) {
  .markdown-content img {
    max-width: 100%;
  }
}


.detail-card {

  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  margin-top: 20px;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  padding: 30px;
}

.news-header {
  text-align: center;
  margin-bottom: 32px;
}

.news-header h1 {
  font-size: 28px;
  font-weight: 600;
  color: var(--claude-text-primary);
  margin-bottom: 16px;
  font-family: var(--claude-font-serif);
}

.news-meta {
  display: flex;
  justify-content: center;
  gap: 24px;
  color: var(--claude-text-secondary);
  font-size: 15px;
  margin-bottom: 24px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 最可靠的居中方案 */
.cover-container {
  display: flex;
  justify-content: center;
  margin: 24px 0;
  width: 100%;
}

.news-cover {
  max-width: 100%;
  max-height: 500px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  object-fit: contain; /* 保持比例 */
}

/* 响应式调整 */
@media (max-width: 768px) {
  .news-cover {
    max-height: 300px;
  }
}

.markdown-content {
  line-height: 1.8;
  font-size: 16px;
  color: var(--claude-text-primary);
  margin-bottom: 40px;
}

.news-actions {
  text-align: center;
  margin-top: 40px;
}

.loading-spin {
  width: 100%;
  padding: 100px 0;
  text-align: center;
}

.to-top-btn {
  position: fixed;
  right: 20px;
  bottom: 80px;
  background-color: var(--claude-bg-dark);
  border-color: var(--claude-bg-dark);
  width: 50px;
  height: 50px;
  font-size: 20px;
  box-shadow: var(--claude-shadow-md);
  margin-right: 15px;
}
/* 响应式设计 */
@media (max-width: 768px) {
  .detail-card {
    padding: 20px;
    border-radius: 0;
  }

  .news-header h1 {
    font-size: 22px;
  }

  .news-meta {
    flex-direction: column;
    gap: 8px;
    align-items: center;
  }

  .news-cover {
    max-height: 250px;
  }

  .markdown-content {
    font-size: 15px;
  }
}
</style>

<style>
/* 全局覆盖 Markdown 样式 */
.markdown-content table {
  border-collapse: collapse;
  width: 100%;
  margin: 16px 0;
}

.markdown-content th,
.markdown-content td {
  border: 1px solid #ddd;
  padding: 8px 12px;
}

.markdown-content th {
  background-color: var(--claude-bg-card);
}

.markdown-content blockquote {
  border-left: 4px solid var(--claude-brand);
  background: var(--claude-bg-card);
  padding: 12px 16px;
  margin: 16px 0;
  color: var(--claude-text-secondary);
}

.markdown-content pre {
  background: var(--claude-bg-card);
  padding: 12px;
  border-radius: 4px;
  overflow-x: auto;
}

.markdown-content img {
  max-width: 100%;
  border-radius: 4px;
  margin: 8px 0;
}
</style>
