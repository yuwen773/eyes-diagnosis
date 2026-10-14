<script setup lang="ts">
import { computed, toRef } from 'vue'
import { diagnosisImageUrl } from '@/utils/diagnosisImageUrl'
import type { WorkflowView } from '@/api/workflowController'
import { useDiagnosisSave } from '@/composables/useDiagnosisSave'
import WorkflowExplanation from './WorkflowExplanation.vue'

const props = defineProps<{ workflow: WorkflowView }>()
const { confirmation, busy, loaded, error, canPrepare, refresh, act } = useDiagnosisSave(toRef(props, 'workflow'))
const imageUrl = computed(() => confirmation.value
  ? diagnosisImageUrl(confirmation.value.content.imageUrl) : '')
const states = { PENDING: '等待您确认保存', APPROVED: '正式诊断记录已保存', REJECTED: '您已拒绝保存，未建立正式记录',
  EXPIRED: '确认已过期，未建立正式记录', INVALIDATED: '确认已失效，未建立正式记录' }
</script>

<template>
  <section class="workflow-save" aria-label="正式诊断保存" :aria-busy="busy">
    <h4>{{ confirmation ? states[confirmation.status] : '正式诊断记录尚未保存' }}</h4>
    <p>医生复核与您的保存授权分别执行。保存后可在诊断历史中查看记录。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="confirmation?.status === 'APPROVED'">记录编号：{{ confirmation.diagnosisId }}</p>
    <template v-if="confirmation?.status === 'PENDING' && canPrepare">
      <div class="save-preview" aria-label="拟保存内容">
        <h4>拟保存内容</h4>
        <p>本次眼底图片、以下模型评估、解释全文与参考来源将保存到您的诊断记录。</p>
        <p>严重程度：未评估。解释版本：{{ confirmation.content.explanation.revision }}。</p>
        <p>有效期至：{{ new Date(confirmation.expiresAt).toLocaleString('zh-CN') }}</p>
        <p>图片校验标识：<code>{{ confirmation.content.imageDigest }}</code></p>
        <img :src="imageUrl" alt="拟保存的本次眼底图片" />
        <WorkflowExplanation :explanation="confirmation.content.explanation" :reference-prefix="`save-${confirmation.confirmationId}`" />
      </div>
      <div class="save-actions">
        <button type="button" :disabled="busy" class="approve-save" @click="act('approve')">批准并保存正式诊断</button>
        <button type="button" :disabled="busy" @click="act('reject')">拒绝保存</button>
      </div>
    </template>
    <button v-else-if="canPrepare" type="button" :disabled="busy" @click="act()">查看拟保存内容</button>
    <p v-else-if="loaded && confirmation?.status !== 'APPROVED'">当前结果不能保存；请先满足解释发布和必要的医生复核条件。</p>
    <button type="button" :disabled="busy" @click="refresh">刷新保存状态</button>
  </section>
</template>

<style scoped>
.workflow-save { margin-top: 1rem; border-top: 1px solid var(--claude-border-warm); padding-top: 1rem; line-height: 1.7; overflow-wrap: anywhere; }
h4 { margin: 0 0 .75rem; color: var(--claude-text-primary); }
.save-preview { margin: 1rem 0; padding: 1rem; border: 1px solid var(--claude-border-warm); border-radius: 10px; }
.save-preview img { display: block; max-width: min(100%, 240px); max-height: 240px; border-radius: 8px; }
.save-actions { display: flex; flex-wrap: wrap; gap: .75rem; }
button { margin: .5rem .75rem .5rem 0; padding: .55rem .85rem; border: 1px solid var(--claude-border-warm); border-radius: 8px; background: var(--claude-bg-card); color: var(--claude-text-primary); cursor: pointer; }
.approve-save { border-color: var(--claude-accent, #c96442); color: var(--claude-accent, #c96442); }
button:disabled { opacity: .55; cursor: wait; }
button:focus-visible { outline: 2px solid var(--claude-accent, #c96442); outline-offset: 3px; }
</style>
