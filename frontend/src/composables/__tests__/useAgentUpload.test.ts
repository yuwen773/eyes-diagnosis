import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/agentController', () => ({
  uploadAgentImage: vi.fn(async () => 'https://cos/agent-chat/1/u.png'),
  deleteAgentImage: vi.fn(async () => undefined),
}))

import { uploadAgentImage } from '@/api/agentController'
import { useAgentUpload } from '@/composables/useAgentUpload'

describe('useAgentUpload', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('uploads each file exactly once and returns urls', async () => {
    const f = new File(['x'], 'a.png', { type: 'image/png' })
    const uploader = useAgentUpload()
    const { urls } = await uploader.uploadFiles([f])
    expect(uploadAgentImage).toHaveBeenCalledTimes(1)
    expect(urls).toEqual(['https://cos/agent-chat/1/u.png'])
  })

  it('cleanup drains only on explicit success flag', async () => {
    const f = new File(['x'], 'a.png', { type: 'image/png' })
    const uploader = useAgentUpload()
    const { urls } = await uploader.uploadFiles([f])
    uploader.commitSuccess(urls)
    expect(uploader.getPendingDeletions()).toEqual([])
  })
})