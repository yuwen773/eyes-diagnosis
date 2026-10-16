import request from '@/request'
import type { WorkflowView } from './workflowController'

export interface LegacyTask {
  taskId: string
  sourceType: 'workflow' | 'upload'
  status: string
  createdAt: string | null
  updatedAt: string | null
  sourceVersion: string | null
  question: string | null
  requiresUpload: boolean
}

interface Response<T> { code: number; msg: string; data: T }

export async function listLegacyTasks(current: number, signal: AbortSignal) {
  const response = await request<Response<{ records: LegacyTask[]; total: number }>>('/diagnosis/legacy-tasks',
    { method: 'GET', params: { current, pageSize: 20 }, signal })
  return response.data.data
}

export async function getLegacyTask(source: string, taskId: string, signal: AbortSignal) {
  const response = await request<Response<LegacyTask>>(
    `/diagnosis/legacy-tasks/${encodeURIComponent(source)}/${encodeURIComponent(taskId)}`, { method: 'GET', signal })
  return response.data.data
}

export async function rebuildLegacyTask(task: LegacyTask, file: File, key: string) {
  const data = new FormData()
  data.append('file', file)
  data.append('idempotencyKey', key)
  data.append('confirmed', 'true')
  const response = await request<Response<WorkflowView>>(
    `/diagnosis/legacy-tasks/${task.sourceType}/${encodeURIComponent(task.taskId)}/rebuild`, { method: 'POST', data })
  return response.data.data
}
