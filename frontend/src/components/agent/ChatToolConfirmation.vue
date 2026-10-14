<script setup lang="ts">
import { computed, toRef } from 'vue'
import { useToolConfirmations } from '@/composables/useToolConfirmations'

const props = defineProps<{ sessionId: string; loading: boolean }>()
const { rows, busy, error, refresh, decide } = useToolConfirmations(toRef(props, 'sessionId'), toRef(props, 'loading'))
const displayedRows = computed(() => [...rows.value.filter(row => row.status === 'PENDING'),
  ...rows.value.filter(row => row.status !== 'PENDING').reverse()])
const labels = { PENDING: '待您确认，尚未修改', APPROVED: '已批准并完成修改', REJECTED: '已拒绝，未修改', EXPIRED: '已过期，请重新提出修改', INVALIDATED: '内容或权限已变化，请重新提出修改' }
</script>

<template>
  <section v-if="rows.length || error" class="tool-confirmations" aria-label="资料变更确认" :aria-busy="busy">
    <article v-for="row in displayedRows" :key="row.confirmationId" class="confirmation">
      <h3>修改本人简介</h3>
      <p>目标用户：{{ row.content.targetUserId }} · {{ row.content.source.kind === 'mcp' ? 'MCP 资料操作' : '资料操作' }}</p>
      <dl><dt>修改前</dt><dd>{{ row.content.before.userProfile || '未填写' }}</dd>
        <dt>修改后</dt><dd>{{ row.content.after.userProfile || '清空简介' }}</dd></dl>
      <p role="status">{{ labels[row.status] }}</p>
      <p v-if="row.status === 'PENDING'">有效期至 {{ new Date(row.expiresAt).toLocaleString('zh-CN') }}</p>
      <div v-if="row.status === 'PENDING'" class="actions">
        <button type="button" data-action="approve" :disabled="busy || loading" @click="decide(row, 'approve')">批准此版本修改</button>
        <button type="button" data-action="reject" :disabled="busy || loading" @click="decide(row, 'reject')">拒绝修改</button>
      </div>
    </article>
    <p v-if="error" role="alert">{{ error }}</p>
    <button type="button" :disabled="busy || loading" @click="refresh">刷新确认状态</button>
  </section>
</template>

<style scoped>
.tool-confirmations { max-height: 35vh; overflow: auto; margin: .25rem 1.25rem; padding: .75rem 1rem; border: 1px solid var(--claude-border-warm); border-radius: 12px; background: var(--claude-bg-elevated); color: var(--claude-text-primary); overflow-wrap: anywhere; }
.confirmation + .confirmation { border-top: 1px solid var(--claude-border-warm); margin-top: 1rem; }
h3 { margin: .25rem 0; font-size: 1rem; }
p, dl { margin: .5rem 0; font-size: .85rem; }
dt { font-weight: 600; }
dd { margin: .25rem 0 .75rem; white-space: pre-wrap; }
.actions { display: flex; flex-wrap: wrap; gap: .75rem; margin-bottom: .5rem; }
button { font: inherit; color: inherit; background: transparent; border: 1px solid var(--claude-border-warm); border-radius: 8px; padding: .4rem .75rem; cursor: pointer; }
button[data-action=approve] { background: var(--claude-accent, #c96442); color: white; border-color: transparent; }
button:disabled { opacity: .55; cursor: default; }
@media (max-width: 700px) {
  .tool-confirmations { position: fixed; left: 1rem; right: 1rem; bottom: 5rem; z-index: 50; margin: 0; max-height: 65vh; box-shadow: 0 8px 32px #0003; }
}
</style>
