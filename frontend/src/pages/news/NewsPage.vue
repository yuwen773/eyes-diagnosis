<template>
  <div class="news-container">
    <!-- 背景层 -->
    <div class="background-layer"></div>

    <!-- 新闻内容 -->
    <div class="content-wrapper">
      <a-card title="眼科新闻" class="news-list">
        <div v-if="dataList.length === 0" class="empty-state">
          <a-empty description="暂无新闻" />
        </div>
        <div v-else>
          <a-list
            item-layout="vertical"
            size="large"
            :pagination="pagination"
            :data-source="dataList"
          >
            <template #renderItem="{ item }">
              <a-list-item @click="doClickNews(item)" class="news-item">
                <a-list-item-meta>
                  <template #avatar>
                    <a-avatar :src="item.avatar" />
                  </template>
                  <template #title>
                    <h3>{{ item.title }}</h3>
                  </template>
                  <template #description>
                    <div>
                      <div class="news-author">
                        <span>发布人: {{ item.author }}</span>
                        <span class="news-date">{{ dayjs(Number(item.publishTime)).format('YYYY-MM-DD') }}</span>
                      </div>
                      <div class="news-brief">{{ item.summary }}</div>
                    </div>
                  </template>
                </a-list-item-meta>
                <div class="news-content">{{ item.content.substring(0, 150) }}.....</div>
                <template #extra>
                  <img
                    width="272"
                    height="180"
                    object-cover="contain"
                    alt="新闻图片"
                    :src="item.coverImage"
                  />
                </template>
              </a-list-item>
            </template>
          </a-list>
        </div>
      </a-card>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { StarOutlined, LikeOutlined, MessageOutlined } from '@ant-design/icons-vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { listNewsVoByPage, listNewsVoByPageWithCache } from '@/api/newsController'
import { message } from 'ant-design-vue';
import dayjs from 'dayjs';
import { useRouter } from 'vue-router';

const dataList = ref<API.NewsVO[]>([]);
const total = ref(0);
const loading = ref(true);

const searchParams = reactive<API.NewsQueryDTO>({
  current: 1,
  pageSize: 12,
});

//分页参数
const pagination = computed(() => {
  return {
    current: searchParams.current,
    pageSize: searchParams.pageSize,
    total: Number(total.value),
    onChange: (page: number, pageSize: number) => {
      searchParams.current = page;
      searchParams.pageSize = pageSize;
      fetchData();
    }
  };
});

//获取数据
const fetchData = async () => {
  const res = await listNewsVoByPageWithCache(searchParams);
  if (res.data.code === 0 && res.data.data) {
    dataList.value = res.data.data.records ?? [];
    total.value = res.data.data.total ?? 0;
  } else {
    message.error('获取数据失败: ' + res.data.msg);
  }
};

//自动加载
onMounted(() => {
  fetchData();
});

//跳转至新闻详情页面
const router = useRouter();

const doClickNews = (newsItem: API.NewsVO) => {
  router.push({
    path: `/news/${newsItem.id}`,
  });
};
</script>

<style scoped>
.news-container {
  min-height: 100vh;
  background: url('@/assets/login.png') no-repeat center center fixed;
  background-size: cover;
  position: relative;
  overflow: hidden;
  padding: 20px;
}

.background-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
/*  background: inherit;*/
  filter: blur(8px);
  z-index: 0;
}

.content-wrapper {
  position: relative;
  z-index: 1;
  max-width: 1200px;
  margin: 0 auto;
  background: rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 12px;
  padding: 30px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.news-list {
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  background: rgba(255, 255, 255, 0.7);
}

.news-author {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.news-author span:first-child {
  font-weight: bold;
  color: #1a3a5f;
}

.news-date {
  color: #8c8c8c;
  font-size: 14px;
}

.news-brief {
  margin-bottom: 12px;
  line-height: 1.6;
  color: #666;
}

.news-content {
  margin-bottom: 16px;
  line-height: 1.8;
  color: #333;
}

:deep(.ant-list-item) {
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
  padding-bottom: 16px;
  margin-bottom: 16px;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 8px;
  padding: 16px;
  transition: all 0.3s ease;
}

:deep(.ant-list-item:hover) {
  background: rgba(255, 255, 255, 0.8);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

:deep(.ant-list-item:last-child) {
  border-bottom: none;
}

:deep(.ant-list-item-meta) {
  flex: 1;
}

:deep(.ant-list-item-content) {
  flex: 1;
}

:deep(.ant-list-item-action) {
  margin-top: 16px;
}

:deep(.ant-list-item-action a) {
  margin-right: 16px;
  color: #1a3a5f;
}

:deep(.ant-list-item-action a:hover) {
  color: #1890ff;
}

.empty-state {
  text-align: center;
  padding: 40px 0;
}

.news-item:hover {
  cursor: pointer;
}

:deep(.ant-card-head) {
  background: rgba(255, 255, 255, 0.5);
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px 8px 0 0;
}

:deep(.ant-card-body) {
  background: rgba(255, 255, 255, 0.3);
  border-radius: 0 0 8px 8px;
}
</style>
