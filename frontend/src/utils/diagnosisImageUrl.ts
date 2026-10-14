import { API_BASE_URL } from '@/config/env'

// New workflow images are authenticated API resources; legacy COS URLs stay intact.
export function diagnosisImageUrl(url?: string | null) {
  return url?.startsWith('/api/diagnosis/workflows/')
    ? new URL(url, new URL(API_BASE_URL, window.location.origin)).href : url ?? undefined
}
