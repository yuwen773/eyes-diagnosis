<script lang="ts" setup>
import { onMounted, onUnmounted, ref } from 'vue'
import {
  ScanOutlined,
  RobotOutlined,
  ReadOutlined,
  ToolOutlined,
  ThunderboltOutlined,
  EyeOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons-vue'
import { RouterLink } from 'vue-router'

// 仪表盘式 KPI · mono 数字 + 趋势
const kpiStrip = ref([
  { label: '累计诊断', value: '5,632', unit: '例', trend: 'up', delta: '+12.5%', sev: 'low' as const },
  { label: '本月活跃用户', value: '1,284', unit: '人', trend: 'up', delta: '+4.2%', sev: 'low' as const },
  { label: '模型准确率', value: '96.3', unit: '%', trend: 'flat', delta: '持平', sev: 'low' as const },
  { label: '平均诊断耗时', value: '8.4', unit: 's', trend: 'down', delta: '-1.2s', sev: 'low' as const },
])

// 仪表盘式 能力卡（mono 数字 + 严重度色块）
const features = ref([
  {
    id: 'f-diagnosis',
    icon: ScanOutlined,
    label: '01',
    title: '智能图像诊断',
    desc: 'EfficientNet-B4 分类 8 种眼底疾病，输出 Top-3 预测与置信度',
    metric: { val: '8', unit: '类疾病' },
    severity: 'low' as const,
  },
  {
    id: 'f-vision',
    icon: EyeOutlined,
    label: '02',
    title: '多模态视觉分析',
    desc: 'Qwen-VL 结构化输出异常描述、紧急程度与诊疗建议',
    metric: { val: '0.847', unit: '置信度中位数' },
    severity: 'low' as const,
  },
  {
    id: 'f-agent',
    icon: RobotOutlined,
    label: '03',
    title: 'AI 问诊助手',
    desc: '流式对话 + 图像分析 + 知识检索，支持深度追问解读',
    metric: { val: '24/7', unit: '在线响应' },
    severity: 'low' as const,
  },
  {
    id: 'f-rag',
    icon: ReadOutlined,
    label: '04',
    title: '知识库检索',
    desc: '医学文档解析向量化，ChromaDB 语义检索辅助决策',
    metric: { val: '126', unit: '份文档' },
    severity: 'low' as const,
  },
  {
    id: 'f-mcp',
    icon: ToolOutlined,
    label: '05',
    title: 'MCP 工具扩展',
    desc: '动态接入外部工具，按需扩展 AI 问诊能力',
    metric: { val: '< 1', unit: 'min 接入' },
    severity: 'low' as const,
  },
  {
    id: 'f-grpc',
    icon: ThunderboltOutlined,
    label: '06',
    title: 'gRPC 实时推理',
    desc: '高速推理通道，上传即诊断，端到端低延迟',
    metric: { val: '8.4', unit: 's 中位数' },
    severity: 'low' as const,
  },
])

// 仪表盘式 流程（mono 编号 · 编辑网格）
const steps = ref([
  { id: 's-upload', label: 'STEP 01', title: '上传眼底图像', desc: '支持 JPG / PNG / DICOM，一键上传眼底照片', icon: ScanOutlined },
  { id: 's-infer', label: 'STEP 02', title: 'AI 模型推理', desc: 'EfficientNet-B4 分类 + Qwen-VL 视觉解读并行', icon: ThunderboltOutlined },
  { id: 's-report', label: 'STEP 03', title: '获取诊断报告', desc: '诊断标签、概率、可靠性评分与中文解读', icon: ReadOutlined },
  { id: 's-chat', label: 'STEP 04', title: 'AI 深度问诊', desc: '基于视觉分析结果，助手进一步解读与建议', icon: RobotOutlined },
])

// 仪表盘式 风险条（8 种疾病 + 占比）
const diseaseBars = ref([
  { id: 'diabetes', label: '糖尿病视网膜病变', pct: 80, count: '324', sev: 'high' as const },
  { id: 'amd', label: '年龄相关性黄斑变性', pct: 46, count: '187', sev: 'mod' as const },
  { id: 'hypertension', label: '高血压视网膜病变', pct: 23, count: '92', sev: 'low' as const },
  { id: 'cataract', label: '白内障', pct: 18, count: '74', sev: 'low' as const },
  { id: 'myopia', label: '病理性近视', pct: 10, count: '41', sev: 'low' as const },
  { id: 'glaucoma', label: '青光眼', pct: 7, count: '28', sev: 'mod' as const },
  { id: 'normal', label: '正常眼底', pct: 5, count: '21', sev: 'low' as const },
  { id: 'other', label: '其他', pct: 3, count: '12', sev: 'low' as const },
])

let observer: IntersectionObserver | null = null

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          (entry.target as HTMLElement).dataset.revealed = 'true'
        }
      })
    },
    { threshold: 0.12, rootMargin: '0px 0px -50px 0px' },
  )
  document.querySelectorAll('.reveal-section').forEach((el) => observer?.observe(el))
})
onUnmounted(() => observer?.disconnect())
</script>

<template>
  <div class="home-page">
    <!-- ═══ KPI 条带 · 仪表盘式头部 ═══ -->
    <section class="kpi-strip reveal-section" aria-label="平台关键指标">
      <div class="kpi-strip-inner">
        <div class="kpi-strip-header">
          <span class="kpi-overline">PLATFORM · 2026-07</span>
          <h1 class="kpi-strip-title">眼瞳 Iris · 智能眼科诊断平台</h1>
          <p class="kpi-strip-sub">从图像到报告，让每一次诊断都有数据可依。</p>
        </div>
        <div class="kpi-grid">
          <div
            v-for="(k, i) in kpiStrip"
            :key="k.label"
            class="kpi-card"
            :data-sev="k.sev"
            :style="{ '--delay': `${i * 60}ms` }"
          >
            <div class="kpi-label">{{ k.label }}</div>
            <div class="kpi-value-row">
              <span class="kpi-value">{{ k.value }}</span>
              <span class="kpi-unit">{{ k.unit }}</span>
            </div>
            <div class="kpi-trend" :data-trend="k.trend">
              <span class="trend-mark">{{ k.trend === 'up' ? '↑' : k.trend === 'down' ? '↓' : '→' }}</span>
              <span>{{ k.delta }}</span>
              <span class="trend-period">vs 上月</span>
            </div>
          </div>
        </div>
        <div class="kpi-cta">
          <RouterLink to="/diagnosis" class="cta-primary">
            开始诊断
            <ArrowRightOutlined />
          </RouterLink>
          <RouterLink to="/agent" class="cta-secondary">
            与 AI 助手对话
            <ArrowRightOutlined />
          </RouterLink>
        </div>
      </div>
    </section>

    <!-- ═══ 能力指标网格 · 仪表盘式主体 ═══ -->
    <section class="features reveal-section" aria-label="技术能力">
      <div class="features-inner">
        <header class="section-header">
          <h2 class="section-heading">六大能力 · 一目了然</h2>
          <p class="section-intro">每项能力都对应一个可量化的指标，按数字读，不按故事读。</p>
        </header>
        <div class="features-grid">
          <article
            v-for="(f, i) in features"
            :key="f.id"
            class="feature-card"
            :data-sev="f.severity"
            :style="{ '--delay': `${i * 60}ms` }"
          >
            <div class="feature-head">
              <span class="feature-label">{{ f.label }}</span>
              <div class="feature-icon">
                <component :is="f.icon" />
              </div>
            </div>
            <h3 class="feature-title">{{ f.title }}</h3>
            <p class="feature-desc">{{ f.desc }}</p>
            <div class="feature-metric">
              <span class="metric-value">{{ f.metric.val }}</span>
              <span class="metric-unit">{{ f.metric.unit }}</span>
            </div>
          </article>
        </div>
      </div>
    </section>

    <!-- ═══ 诊断流程 · 编辑网格 2x2 ═══ -->
    <section class="steps reveal-section" aria-label="诊断流程">
      <div class="steps-inner">
        <header class="section-header">
          <span class="section-overline">WORKFLOW · 诊断流程</span>
          <h2 class="section-heading">四步完成 · 全程可追踪</h2>
        </header>
        <div class="steps-grid">
          <div
            v-for="(s, i) in steps"
            :key="s.id"
            class="step-card"
            :style="{ '--delay': `${i * 80}ms` }"
          >
            <div class="step-label">{{ s.label }}</div>
            <div class="step-icon-wrap">
              <component :is="s.icon" />
            </div>
            <h3 class="step-title">{{ s.title }}</h3>
            <p class="step-desc">{{ s.desc }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ 疾病风险条 · mono 指标 + 严重度色块 ═══ -->
    <section class="diseases reveal-section" aria-label="疾病识别分布">
      <div class="diseases-inner">
        <header class="section-header">
          <span class="section-overline">COVERAGE · 疾病识别</span>
          <h2 class="section-heading">8 种眼底疾病 · 严重度分级</h2>
          <p class="section-intro">样本分布基于 4,726 例历史诊断 · 严重度独立于品牌色编码</p>
        </header>
        <div class="diseases-table">
          <div class="dt-head">
            <span class="dt-col dt-col-name">疾病</span>
            <span class="dt-col dt-col-bar">占比</span>
            <span class="dt-col dt-col-count">例数</span>
            <span class="dt-col dt-col-sev">风险</span>
          </div>
          <div
            v-for="d in diseaseBars"
            :key="d.id"
            class="dt-row"
            :data-sev="d.sev"
          >
            <span class="dt-col-name">{{ d.label }}</span>
            <span class="dt-col-bar">
              <span class="dt-track">
                <span class="dt-fill" :style="{ width: d.pct + '%' }"></span>
              </span>
            </span>
            <span class="dt-col-count">{{ d.count }}</span>
            <span class="dt-col-sev">
              <span class="sev-pill" :data-sev="d.sev">{{ d.sev === 'high' ? 'HIGH' : d.sev === 'mod' ? 'MOD' : 'LOW' }}</span>
            </span>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ CTA · 仪表盘式收尾 ═══ -->
    <section class="cta-section reveal-section">
      <div class="cta-inner">
        <div class="cta-metric">
          <div class="cta-metric-label">现在就开始</div>
          <div class="cta-metric-value">8.4 s</div>
          <div class="cta-metric-unit">平均诊断耗时</div>
        </div>
        <div class="cta-text">
          <h2 class="cta-heading">让 AI 成为你的第一道诊断</h2>
          <p>上传一张眼底照片，AI 即刻为你分析，几分钟内获取诊断参考。</p>
        </div>
        <RouterLink to="/diagnosis" class="cta-button">
          立即体验
          <ArrowRightOutlined />
        </RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* ════════════════════════════════════════════
   仪表盘式 · 方向 B
   - mono 数字 + 严重度色块 + 编辑网格
   - 衬线 500-600，sans 主导，mono 给数据
   - 中等品牌色密度：CTA + 数据高亮 + 严重度编码
   - 不做 hero 居中叙事、不做入场动画大编排
   ════════════════════════════════════════════ */
.home-page {
  background: var(--iris-bg);
  min-height: 100vh;
}

::selection {
  background: var(--iris-accent-soft);
  color: var(--iris-ink);
}

button:focus-visible,
a:focus-visible,
input:focus-visible,
.kpi-card:focus-visible,
.feature-card:focus-visible {
  outline: none;
  box-shadow: var(--iris-focus-ring);
}

/* ═══ Reveal ═══ */
.reveal-section {
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 500ms var(--iris-transition-base),
              transform 500ms var(--iris-transition-base);
}
.reveal-section[data-revealed='true'] {
  opacity: 1;
  transform: translateY(0);
}

/* ═══ Section header（编辑式左对齐，不用居中）═══ */
.section-header {
  margin-bottom: 40px;
  max-width: 720px;
}
.section-overline {
  display: inline-block;
  font-family: var(--iris-font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--iris-accent);
  margin-bottom: 10px;
}
.section-heading {
  font-family: var(--iris-font-serif);
  font-size: clamp(24px, 3vw, 30px);
  font-weight: 600;
  color: var(--iris-ink);
  margin: 0 0 8px 0;
  line-height: 1.2;
  letter-spacing: -0.01em;
}
.section-intro {
  font-size: 14px;
  color: var(--iris-ink-2);
  margin: 0;
  line-height: 1.65;
  max-width: 60ch;
}

/* ═══ KPI 条带 · 仪表盘式头部 ═══ */
.kpi-strip {
  padding: 64px 0 56px;
  background: var(--iris-surface);
  border-bottom: 1px solid var(--iris-line);
}
.kpi-strip-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 40px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 36px;
}
.kpi-strip-header { max-width: 720px; }
.kpi-overline {
  display: inline-block;
  font-family: var(--iris-font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--iris-accent);
  margin-bottom: 14px;
}
.kpi-strip-title {
  font-family: var(--iris-font-serif);
  font-size: clamp(32px, 4vw, 44px);
  font-weight: 600;
  color: var(--iris-ink);
  margin: 0 0 12px 0;
  line-height: 1.15;
  letter-spacing: -0.015em;
  max-width: 18ch;
}
.kpi-strip-sub {
  font-size: 16px;
  color: var(--iris-ink-2);
  margin: 0;
  line-height: 1.65;
  max-width: 56ch;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  border: 1px solid var(--iris-line);
  border-radius: 6px;
  overflow: hidden;
  background: var(--iris-surface-2);
}
.kpi-card {
  padding: 22px 24px;
  border-right: 1px solid var(--iris-line);
  background: var(--iris-surface);
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
  transition: background 200ms var(--iris-transition-fast);
}
.kpi-card:last-child { border-right: none; }
.kpi-card:nth-child(1) { padding: 22px 28px; background: var(--iris-bg); }
.kpi-card:nth-child(1) .kpi-value { font-size: 38px; }
.kpi-card:hover { background: var(--iris-surface-2); }
.kpi-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0;
  width: 3px; height: 100%;
  background: var(--iris-accent);
  opacity: 0;
  transition: opacity 200ms;
}
.kpi-card:hover::before { opacity: 1; }

.kpi-label {
  font-family: var(--iris-font-sans);
  font-size: 11px;
  font-weight: 600;
  color: var(--iris-ink-3);
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
.kpi-value-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 2px 0 4px;
}
.kpi-value {
  font-family: var(--iris-font-mono);
  font-size: 30px;
  font-weight: 600;
  color: var(--iris-ink);
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
.kpi-unit {
  font-family: var(--iris-font-sans);
  font-size: 12px;
  color: var(--iris-ink-2);
}
.kpi-trend {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-family: var(--iris-font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.kpi-trend .trend-mark { font-weight: 600; }
.kpi-trend .trend-period { color: var(--iris-ink-3); margin-left: 2px; }
.kpi-trend[data-trend='up'] { color: var(--iris-sev-low); }
.kpi-trend[data-trend='down'] { color: var(--iris-sev-low); }
.kpi-trend[data-trend='flat'] { color: var(--iris-ink-3); }

.kpi-cta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.cta-primary,
.cta-secondary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 22px;
  font-size: 14px;
  font-weight: 600;
  border-radius: 6px;
  text-decoration: none;
  transition: all 200ms var(--iris-transition-base);
  letter-spacing: 0.01em;
}
.cta-primary {
  background: var(--iris-accent);
  color: var(--iris-on-accent);
  border: 1px solid var(--iris-accent);
}
.cta-primary:hover {
  background: var(--iris-accent-strong);
  border-color: var(--iris-accent-strong);
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(27, 127, 107, 0.22);
}
.cta-secondary {
  background: var(--iris-surface);
  color: var(--iris-ink);
  border: 1px solid var(--iris-line-strong);
}
.cta-secondary:hover {
  border-color: var(--iris-accent);
  color: var(--iris-accent);
  transform: translateY(-1px);
}
.cta-primary :deep(.anticon),
.cta-secondary :deep(.anticon) {
  transition: transform 200ms var(--iris-transition-base);
}
.cta-primary:hover :deep(.anticon),
.cta-secondary:hover :deep(.anticon) {
  transform: translateX(3px);
}

/* ═══ 能力指标网格 ═══ */
.features { padding: 72px 0; background: var(--iris-bg); }
.features-inner { max-width: 1200px; margin: 0 auto; padding: 0 40px; }

.features-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  border: 1px solid var(--iris-line);
  border-radius: 8px;
  overflow: hidden;
  background: var(--iris-surface);
}
.feature-card {
  padding: 24px 24px 22px;
  border-right: 1px solid var(--iris-line);
  border-bottom: 1px solid var(--iris-line);
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--iris-surface);
  transition: background 200ms var(--iris-transition-fast);
  position: relative;
}
.feature-card:nth-child(3n) { border-right: none; }
.feature-card:nth-last-child(-n+3) { border-bottom: none; }
.feature-card:hover { background: var(--iris-surface-2); }
.feature-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: var(--iris-accent);
  opacity: 0;
  transition: opacity 200ms;
}
.feature-card:hover::before { opacity: 1; }

.feature-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.feature-label {
  font-family: var(--iris-font-mono);
  font-size: 10px;
  font-weight: 600;
  color: var(--iris-ink-3);
  letter-spacing: 1px;
}
.feature-icon {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  background: var(--iris-accent-soft);
  color: var(--iris-accent);
  border-radius: 6px;
  font-size: 16px;
  transition: background 200ms, color 200ms;
}
.feature-card:hover .feature-icon {
  background: var(--iris-accent);
  color: var(--iris-on-accent);
}
.feature-title {
  font-family: var(--iris-font-serif);
  font-size: 18px;
  font-weight: 600;
  color: var(--iris-ink);
  margin: 0;
  line-height: 1.3;
  letter-spacing: -0.01em;
}
.feature-desc {
  font-size: 13px;
  color: var(--iris-ink-2);
  line-height: 1.6;
  margin: 0;
  flex: 1;
}
.feature-metric {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--iris-line);
  margin-top: 4px;
}
.metric-value {
  font-family: var(--iris-font-mono);
  font-size: 22px;
  font-weight: 600;
  color: var(--iris-accent);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.metric-unit {
  font-family: var(--iris-font-sans);
  font-size: 11px;
  color: var(--iris-ink-2);
}

/* ═══ 诊断流程 · 编辑 2x2 ═══ */
.steps { padding: 72px 0; background: var(--iris-surface); border-top: 1px solid var(--iris-line); border-bottom: 1px solid var(--iris-line); }
.steps-inner { max-width: 1200px; margin: 0 auto; padding: 0 40px; }
.steps-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
  border: 1px solid var(--iris-line);
  border-radius: 8px;
  overflow: hidden;
  background: var(--iris-bg);
}
.step-card {
  padding: 28px 28px 24px;
  border-right: 1px solid var(--iris-line);
  border-bottom: 1px solid var(--iris-line);
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto auto;
  gap: 8px 12px;
  background: var(--iris-surface);
  transition: background 200ms;
}
.step-card:nth-child(2n) { border-right: none; }
.step-card:nth-last-child(-n+2) { border-bottom: none; }
.step-card:hover { background: var(--iris-surface-2); }

.step-label {
  font-family: var(--iris-font-mono);
  font-size: 10px;
  font-weight: 600;
  color: var(--iris-ink-3);
  letter-spacing: 1.2px;
  grid-column: 1;
  grid-row: 1;
}
.step-icon-wrap {
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  background: var(--iris-accent-soft);
  color: var(--iris-accent);
  border-radius: 6px;
  font-size: 18px;
  grid-column: 2;
  grid-row: 1 / 4;
  align-self: start;
}
.step-title {
  font-family: var(--iris-font-serif);
  font-size: 17px;
  font-weight: 600;
  color: var(--iris-ink);
  margin: 0;
  line-height: 1.3;
  letter-spacing: -0.01em;
  grid-column: 1;
  grid-row: 2;
}
.step-desc {
  font-size: 13px;
  color: var(--iris-ink-2);
  line-height: 1.6;
  margin: 0;
  grid-column: 1;
  grid-row: 3;
  max-width: 52ch;
}

/* ═══ 疾病风险条 ═══ */
.diseases { padding: 72px 0; background: var(--iris-bg); }
.diseases-inner { max-width: 1200px; margin: 0 auto; padding: 0 40px; }

.diseases-table {
  border: 1px solid var(--iris-line);
  border-radius: 8px;
  overflow: hidden;
  background: var(--iris-surface);
}
.dt-head,
.dt-row {
  display: grid;
  grid-template-columns: 1.6fr 2fr 0.6fr 0.6fr;
  align-items: center;
  padding: 14px 20px;
  gap: 16px;
}
.dt-head {
  background: var(--iris-surface-2);
  border-bottom: 1px solid var(--iris-line);
  font-family: var(--iris-font-mono);
  font-size: 10px;
  font-weight: 600;
  color: var(--iris-ink-3);
  letter-spacing: 1px;
  text-transform: uppercase;
}
.dt-row {
  border-bottom: 1px solid var(--iris-line);
  font-size: 14px;
  color: var(--iris-ink);
  transition: background 150ms;
}
.dt-row:last-child { border-bottom: none; }
.dt-row:hover { background: var(--iris-surface-2); }
.dt-col-name { font-family: var(--iris-font-sans); font-weight: 500; }
.dt-col-bar { display: flex; align-items: center; }
.dt-track {
  flex: 1;
  height: 8px;
  background: var(--iris-surface-2);
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--iris-line);
}
.dt-fill {
  display: block;
  height: 100%;
  background: var(--iris-accent);
  border-radius: 4px;
  transition: width 600ms var(--iris-transition-base);
}
.dt-row[data-sev='high'] .dt-fill { background: var(--iris-sev-high); }
.dt-row[data-sev='mod'] .dt-fill { background: var(--iris-sev-moderate); }
.dt-col-count {
  font-family: var(--iris-font-mono);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--iris-ink-2);
  text-align: right;
}
.dt-col-sev { text-align: right; }
.sev-pill {
  font-family: var(--iris-font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.5px;
  padding: 3px 8px;
  border-radius: 4px;
}
.sev-pill[data-sev='high'] { background: var(--iris-sev-high-soft); color: var(--iris-sev-high); }
.sev-pill[data-sev='mod'] { background: var(--iris-sev-moderate-soft); color: var(--iris-sev-moderate); }
.sev-pill[data-sev='low'] { background: var(--iris-sev-low-soft); color: var(--iris-sev-low); }

/* ═══ CTA ═══ */
.cta-section {
  padding: 64px 0 80px;
  background: var(--iris-bg);
  border-top: 1px solid var(--iris-line);
}
.cta-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 40px;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 40px;
  background: var(--iris-surface);
  border: 1px solid var(--iris-line);
  border-radius: 8px;
  padding: 32px 40px;
}
.cta-metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-right: 32px;
  border-right: 1px solid var(--iris-line);
}
.cta-metric-label {
  font-family: var(--iris-font-mono);
  font-size: 10px;
  font-weight: 600;
  color: var(--iris-ink-3);
  letter-spacing: 1px;
  text-transform: uppercase;
}
.cta-metric-value {
  font-family: var(--iris-font-mono);
  font-size: 40px;
  font-weight: 600;
  color: var(--iris-accent);
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
.cta-metric-unit {
  font-size: 12px;
  color: var(--iris-ink-2);
}
.cta-text h2 {
  font-family: var(--iris-font-serif);
  font-size: 22px;
  font-weight: 600;
  color: var(--iris-ink);
  margin: 0 0 6px 0;
  line-height: 1.3;
  letter-spacing: -0.01em;
}
.cta-text p {
  font-size: 14px;
  color: var(--iris-ink-2);
  margin: 0;
  line-height: 1.6;
}
.cta-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 0 28px;
  font-size: 15px;
  font-weight: 600;
  background: var(--iris-accent);
  color: var(--iris-on-accent);
  border-radius: 6px;
  text-decoration: none;
  transition: all 200ms var(--iris-transition-base);
}
.cta-button:hover {
  background: var(--iris-accent-strong);
  transform: translateY(-1px);
  box-shadow: 0 8px 20px rgba(27, 127, 107, 0.25);
}
.cta-button :deep(.anticon) { transition: transform 200ms; }
.cta-button:hover :deep(.anticon) { transform: translateX(3px); }

/* ═══ Responsive ═══ */
@media (max-width: 1024px) {
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
  .kpi-card { border-right: 1px solid var(--iris-line); border-bottom: 1px solid var(--iris-line); }
  .kpi-card:nth-child(2n) { border-right: none; }
  .kpi-card:nth-last-child(-n+2) { border-bottom: none; }
  .features-grid { grid-template-columns: repeat(2, 1fr); }
  .feature-card:nth-child(3n) { border-right: 1px solid var(--iris-line); }
  .feature-card:nth-child(2n) { border-right: none; }
  .feature-card:nth-last-child(-n+3) { border-bottom: 1px solid var(--iris-line); }
  .feature-card:nth-last-child(-n+2) { border-bottom: none; }
  .cta-inner { grid-template-columns: 1fr; }
  .cta-metric { border-right: none; border-bottom: 1px solid var(--iris-line); padding: 0 0 20px; }
}
@media (max-width: 768px) {
  .kpi-strip-inner,
  .features-inner,
  .steps-inner,
  .diseases-inner { padding: 0 20px; }
  .kpi-strip { padding: 48px 0 40px; }
  .features, .steps, .diseases, .cta-section { padding: 56px 0; }
  .kpi-grid { grid-template-columns: 1fr; }
  .kpi-card { border-right: none; border-bottom: 1px solid var(--iris-line); }
  .kpi-card:last-child { border-bottom: none; }
  .features-grid { grid-template-columns: 1fr; }
  .feature-card { border-right: none; border-bottom: 1px solid var(--iris-line); }
  .feature-card:last-child { border-bottom: none; }
  .steps-grid { grid-template-columns: 1fr; }
  .step-card { border-right: none; border-bottom: 1px solid var(--iris-line); }
  .step-card:last-child { border-bottom: none; }
  .dt-head, .dt-row { grid-template-columns: 1.4fr 1.6fr 0.5fr 0.5fr; gap: 10px; padding: 12px 14px; }
  .cta-inner { padding: 24px 20px; }
  .cta-metric-value { font-size: 32px; }
}
@media (max-width: 480px) {
  .kpi-strip-title { font-size: 28px; }
  .section-heading { font-size: 22px; }
  .dt-head, .dt-row { font-size: 12px; padding: 10px 12px; gap: 8px; }
  .sev-pill { font-size: 9px; padding: 2px 6px; }
}
</style>
