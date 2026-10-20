<script lang="ts" setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { listNewsVoByPageWithCache } from '@/api/newsController'
import { message } from 'ant-design-vue';
import dayjs from 'dayjs';
import { useRouter } from 'vue-router';
import { ClockCircleOutlined, UserOutlined } from '@ant-design/icons-vue';

const dataList = ref<API.NewsVO[]>([]);
const total = ref(0);
const loading = ref(true);

const searchParams = reactive<API.NewsQueryDTO>({
  current: 1,
  pageSize: 12,
});

const pagination = computed(() => ({
  current: searchParams.current,
  pageSize: searchParams.pageSize,
  total: Number(total.value),
  onChange: (page: number, pageSize: number) => {
    searchParams.current = page;
    searchParams.pageSize = pageSize;
    fetchData();
  },
}));

const featuredArticle = computed(() => dataList.value[0] ?? null);
const articles = computed(() => dataList.value.slice(1));

const fetchData = async () => {
  loading.value = true;
  try {
    const res = await listNewsVoByPageWithCache(searchParams);
    if (res.data.code === 0 && res.data.data) {
      dataList.value = res.data.data.records ?? [];
      total.value = res.data.data.total ?? 0;
    } else {
      message.error('获取数据失败: ' + res.data.msg);
    }
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  fetchData();
});

const router = useRouter();

const doClickNews = (newsItem: API.NewsVO) => {
  router.push({ path: `/news/${newsItem.id}` });
};

const formatDate = (ts?: string | number) => {
  if (!ts) return '';
  return dayjs(Number(ts)).format('YYYY年M月D日');
};
</script>

<template>
  <div class="news-page">
    <!-- Page Header -->
    <header class="page-header">
      <div class="header-inner">
        <span class="header-overline">Eye Health Insights</span>
        <h1 class="header-title">眼科前沿</h1>
        <p class="header-subtitle">最新眼科医学动态、研究进展与健康科普</p>
      </div>
    </header>

    <div class="page-body">
      <!-- Empty State -->
      <div v-if="!loading && dataList.length === 0" class="empty-state">
        <div class="empty-icon">📰</div>
        <p class="empty-text">暂无新闻，敬请期待</p>
      </div>

      <template v-else>
        <!-- Featured Article -->
        <section
          v-if="featuredArticle"
          class="featured-section"
          @click="doClickNews(featuredArticle)"
        >
          <div class="featured-card">
            <div class="featured-image-col">
              <div class="featured-image-wrapper">
                <img
                  v-if="featuredArticle.coverImage"
                  :src="featuredArticle.coverImage"
                  :alt="featuredArticle.title"
                  class="featured-image"
                />
                <div v-else class="featured-image-placeholder">
                  <span>眼健康</span>
                </div>
              </div>
            </div>
            <div class="featured-content">
              <span class="featured-tag">精选</span>
              <h2 class="featured-title">{{ featuredArticle.title }}</h2>
              <p class="featured-summary">{{ featuredArticle.summary }}</p>
              <div class="featured-meta">
                <span class="meta-chip">
                  <user-outlined />
                  {{ featuredArticle.author }}
                </span>
                <span class="meta-chip">
                  <clock-circle-outlined />
                  {{ formatDate(featuredArticle.publishTime) }}
                </span>
              </div>
            </div>
          </div>
        </section>

        <!-- Article Grid -->
        <section v-if="articles.length > 0" class="grid-section">
          <div class="article-grid">
            <article
              v-for="(item, idx) in articles"
              :key="item.id"
              class="article-card"
              :style="{ '--stagger': `${idx * 60}ms` }"
              @click="doClickNews(item)"
            >
              <div class="card-image-wrapper">
                <img
                  v-if="item.coverImage"
                  :src="item.coverImage"
                  :alt="item.title"
                  class="card-image"
                />
                <div v-else class="card-image-placeholder">
                  <span>眼科</span>
                </div>
              </div>
              <div class="card-body">
                <h3 class="card-title">{{ item.title }}</h3>
                <p class="card-summary">{{ item.summary }}</p>
                <div class="card-meta">
                  <span>{{ item.author }}</span>
                  <span>{{ formatDate(item.publishTime) }}</span>
                </div>
              </div>
            </article>
          </div>
        </section>
      </template>

      <!-- Pagination -->
      <div v-if="total > (searchParams.pageSize ?? 12)" class="pagination-bar">
        <a-pagination v-bind="pagination" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.news-page {
  min-height: 100vh;
  background: var(--claude-bg-page);
}

/* ─── Page Header ─── */
.page-header {
  background: var(--claude-bg-card);
  border-bottom: 1px solid var(--claude-border-cream);
  padding: 3.5rem 2rem 3rem;
  text-align: center;
  position: relative;
  overflow: hidden;
}

.page-header::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 80% 60% at 50% 0%, oklch(0.6 0.05 175 / 0.08), transparent),
    radial-gradient(ellipse 60% 40% at 80% 100%, oklch(0.6 0.05 175 / 0.05), transparent);
  pointer-events: none;
}

.header-inner {
  position: relative;
  max-width: 640px;
  margin: 0 auto;
}

.header-overline {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--claude-brand);
  margin-bottom: 0.75rem;
}

.header-title {
  font-family: var(--claude-font-serif);
  font-size: clamp(2.2rem, 5vw, 3.2rem);
  font-weight: 700;
  color: var(--claude-text-primary);
  line-height: 1.15;
  margin: 0 0 0.5rem;
}

.header-subtitle {
  font-size: 1.05rem;
  color: var(--claude-text-tertiary);
  margin: 0;
  line-height: 1.5;
}

/* ─── Page Body ─── */
.page-body {
  max-width: 1120px;
  margin: 0 auto;
  padding: 2.5rem 1.5rem 4rem;
}

/* ─── Empty State ─── */
.empty-state {
  text-align: center;
  padding: 6rem 1rem;
}

.empty-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.empty-text {
  font-size: 1.1rem;
  color: var(--claude-text-tertiary);
}

/* ─── Featured Article ─── */
.featured-section {
  margin-bottom: 3rem;
  cursor: pointer;
}

.featured-card {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  background: var(--claude-bg-card);
  border-radius: var(--claude-radius-xl);
  overflow: hidden;
  box-shadow: var(--claude-shadow-lg);
  transition: box-shadow var(--claude-transition-slow), transform var(--claude-transition-slow);
}

.featured-section:hover .featured-card {
  box-shadow: var(--claude-shadow-xl);
  transform: translateY(-2px);
}

.featured-image-col {
  position: relative;
  min-height: 340px;
}

.featured-image-wrapper,
.featured-image-placeholder {
  position: absolute;
  inset: 0;
}

.featured-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.featured-image-placeholder {
  background: linear-gradient(135deg, oklch(0.6 0.05 175 / 0.2), oklch(0.6 0.05 175 / 0.08));
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--claude-font-serif);
  font-size: 1.8rem;
  color: var(--claude-brand);
  opacity: 0.6;
}

.featured-content {
  padding: 2.5rem 2.5rem 2.5rem 2rem;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.featured-tag {
  display: inline-block;
  width: fit-content;
  padding: 0.2rem 0.75rem;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--claude-brand);
  background: oklch(0.6 0.05 175 / 0.1);
  border-radius: 999px;
  margin-bottom: 1rem;
}

.featured-title {
  font-family: var(--claude-font-serif);
  font-size: clamp(1.5rem, 2.5vw, 2rem);
  font-weight: 700;
  color: var(--claude-text-primary);
  line-height: 1.25;
  margin: 0 0 0.75rem;
}

.featured-summary {
  font-size: 0.95rem;
  line-height: 1.7;
  color: var(--claude-text-secondary);
  margin: 0 0 1.5rem;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.featured-meta {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.meta-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  color: var(--claude-text-tertiary);
}

/* ─── Article Grid ─── */
.grid-section {
  margin-bottom: 2rem;
}

.article-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1.5rem;
}

.article-card {
  background: var(--claude-bg-card);
  border-radius: var(--claude-radius-lg);
  overflow: hidden;
  box-shadow: var(--claude-shadow-sm);
  cursor: pointer;
  transition:
    box-shadow var(--claude-transition-slow),
    transform var(--claude-transition-slow);
  animation: cardEnter 0.5s ease-out both;
  animation-delay: var(--stagger);
}

.article-card:hover {
  box-shadow: var(--claude-shadow-lg);
  transform: translateY(-3px);
}

@keyframes cardEnter {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.card-image-wrapper {
  position: relative;
  aspect-ratio: 16 / 9;
  overflow: hidden;
}

.card-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.5s ease-out;
}

.article-card:hover .card-image {
  transform: scale(1.04);
}

.card-image-placeholder {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, oklch(0.9 0.03 175), oklch(0.92 0.03 175));
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--claude-font-serif);
  font-size: 1.1rem;
  color: var(--claude-text-tertiary);
  opacity: 0.5;
}

.card-body {
  padding: 1.25rem 1.25rem 1rem;
}

.card-title {
  font-family: var(--claude-font-serif);
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--claude-text-primary);
  line-height: 1.35;
  margin: 0 0 0.5rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-summary {
  font-size: 0.85rem;
  line-height: 1.6;
  color: var(--claude-text-secondary);
  margin: 0 0 0.75rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-meta {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--claude-text-tertiary);
}

/* ─── Pagination ─── */
.pagination-bar {
  display: flex;
  justify-content: center;
  padding-top: 1rem;
}

/* ─── Responsive ─── */
@media (max-width: 768px) {
  .page-header {
    padding: 2.5rem 1.25rem 2rem;
  }

  .page-body {
    padding: 1.5rem 1rem 3rem;
  }

  .featured-card {
    grid-template-columns: 1fr;
  }

  .featured-image-col {
    min-height: 220px;
  }

  .featured-content {
    padding: 1.5rem;
  }

  .article-grid {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
}
</style>
