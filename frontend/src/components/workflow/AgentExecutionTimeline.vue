<script setup lang="ts">
/**
 * AgentExecutionTimeline —— Agent 执行时间线渲染器。
 *
 * 与 WorkflowTimeline（状态机步骤视图）互补：这里把后端 segment / 事件
 * 派生为一条固定的 Agent 流水线
 *   Image Quality → Vision → Evidence → Explanation → Human Review（如有）
 * 已完成 ✓ / 进行中 loading / 未开始置灰；Human Review 使用医生图标。
 *
 * 渲染规则：节点状态完全来自 deriveAgentNodes() 的纯推导，组件本身不持有业务状态。
 */
import { computed } from 'vue'
import {
  FileImageOutlined,
  EyeOutlined,
  ReadOutlined,
  FileTextOutlined,
  SolutionOutlined,
} from '@ant-design/icons-vue'
import type { WorkflowEventView, WorkflowProgressView } from '@/api/workflow'
import { deriveAgentNodes, type AgentKey, type AgentNode } from './agentTimeline'

const props = defineProps<{
  status?: string | null
  progress?: WorkflowProgressView | null
  events?: WorkflowEventView[] | null
}>()

const nodes = computed<AgentNode[]>(() =>
  deriveAgentNodes({
    status: props.status ?? null,
    progress: props.progress ?? null,
    events: props.events ?? null,
  }),
)

const ICONS: Record<AgentKey, unknown> = {
  'image-quality': FileImageOutlined,
  vision: EyeOutlined,
  evidence: ReadOutlined,
  explanation: FileTextOutlined,
  'human-review': SolutionOutlined,
}

const STATE_LABEL: Record<AgentNode['state'], string> = {
  completed: '已完成',
  current: '进行中',
  pending: '未开始',
}
</script>

<template>
  <div class="agent-timeline" data-testid="agent-execution-timeline">
    <h3 class="agent-timeline__title">Agent 执行时间线</h3>

    <ol class="agent-timeline__list">
      <li
        v-for="(node, index) in nodes"
        :key="node.key"
        class="agent-node"
        :class="`agent-node--${node.state}`"
        :data-agent="node.key"
        :data-agent-state="node.state"
      >
        <span class="agent-node__connector" aria-hidden="true" />
        <span class="agent-node__marker" aria-hidden="true">
          <svg
            v-if="node.state === 'completed'"
            class="agent-node__check"
            viewBox="0 0 16 16"
            width="12"
            height="12"
          >
            <path
              d="M3 8.5 6.5 12 13 4.5"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span v-else-if="node.state === 'current'" class="agent-node__spinner" />
        </span>
        <span class="agent-node__icon" aria-hidden="true">
          <component :is="ICONS[node.key]" />
        </span>
        <span class="agent-node__body">
          <span class="agent-node__name">{{ node.name }}</span>
          <span class="agent-node__desc">{{ node.description }}</span>
        </span>
        <span class="agent-node__state">{{ STATE_LABEL[node.state] }}</span>
        <span
          v-if="index < nodes.length - 1"
          class="agent-node__line"
          aria-hidden="true"
        />
      </li>
    </ol>
  </div>
</template>

<style scoped>
.agent-timeline {
  background: #faf9f5;
  border: 1px solid #e8e6dc;
  border-radius: 12px;
  padding: 20px 24px;
  margin-top: 16px;
}
.agent-timeline__title {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 17px;
  color: #141413;
  margin: 0 0 16px;
}
.agent-timeline__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}
.agent-node {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
}
.agent-node:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 27px;
  top: 46px;
  bottom: -10px;
  width: 2px;
  background: #e3e1d7;
}
.agent-node--completed:not(:last-child)::after {
  background: #cfe3d6;
}
.agent-node__marker {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 2px solid #e3e1d7;
  background: #fff;
  color: #fff;
  z-index: 1;
}
.agent-node--completed .agent-node__marker {
  background: #3f9160;
  border-color: #3f9160;
}
.agent-node--current .agent-node__marker {
  border-color: #c96442;
  background: rgba(201, 100, 66, 0.15);
}
.agent-node__check {
  color: #fff;
}
.agent-node__spinner {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid rgba(201, 100, 66, 0.35);
  border-top-color: #c96442;
  animation: agent-spin 0.8s linear infinite;
}
@keyframes agent-spin {
  to {
    transform: rotate(360deg);
  }
}
.agent-node__icon {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  background: #f0eee6;
  color: #6b6a66;
  flex-shrink: 0;
}
.agent-node--completed .agent-node__icon {
  background: rgba(63, 145, 96, 0.12);
  color: #2f7d4f;
}
.agent-node--current .agent-node__icon {
  background: rgba(201, 100, 66, 0.12);
  color: #c96442;
}
.agent-node--pending .agent-node__icon {
  opacity: 0.55;
}
.agent-node__body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.agent-node__name {
  font-size: 14px;
  color: #141413;
  font-weight: 600;
}
.agent-node--pending .agent-node__name {
  color: #8f8d86;
  font-weight: 500;
}
.agent-node__desc {
  font-size: 12px;
  color: #8f8d86;
}
.agent-node__state {
  margin-left: auto;
  font-size: 12px;
  color: #8f8d86;
  flex-shrink: 0;
}
.agent-node--completed .agent-node__state {
  color: #2f7d4f;
}
.agent-node--current .agent-node__state {
  color: #c96442;
}
</style>
