import { ref } from 'vue'
import { uploadAgentImage } from '@/api/agentController'

const inFlight = new Map<string, Promise<string>>()

interface UploadResult {
  urls: string[]
}

export function useAgentUpload() {
  const pendingDeletions = ref<string[]>([])

  function fileKey(file: File): string {
    return `${file.name}:${file.size}:${file.lastModified}`
  }

  async function uploadFiles(files: File[]): Promise<UploadResult> {
    const urls: string[] = []
    for (const file of files) {
      const key = fileKey(file)
      const existing = inFlight.get(key)
      const promise = existing ?? uploadAgentImage(file)
      if (!existing) {
        inFlight.set(key, promise)
      }
      try {
        urls.push(await promise)
      } finally {
        inFlight.delete(key)
      }
    }
    pendingDeletions.value.push(...urls)
    return { urls }
  }

  function commitSuccess(urls: string[]) {
    pendingDeletions.value = pendingDeletions.value.filter(u => !urls.includes(u))
  }

  function commitFailure(urls: string[]) {
    pendingDeletions.value = pendingDeletions.value.filter(u => !urls.includes(u))
  }

  function getPendingDeletions(): string[] {
    return [...pendingDeletions.value]
  }

  return { uploadFiles, commitSuccess, commitFailure, getPendingDeletions, pendingDeletions }
}