import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/agentController', () => ({
  uploadAgentImage: vi.fn(async () => 'https://cos/agent-chat/1/u.png'),
  deleteAgentImage: vi.fn(async () => undefined),
}))

import { deleteAgentImage, uploadAgentImage } from '@/api/agentController'
import { useAgentUpload } from '@/composables/useAgentUpload'
import { releaseAgentImage } from '@/composables/agentImageOwnership'

const mockUpload = vi.mocked(uploadAgentImage)
const mockDelete = vi.mocked(deleteAgentImage)

// 所有权账本是模块级状态，每个用例必须换一个 URL 才能彼此隔离
let seq = 0
const uniqueUrl = () => `https://cos/agent-chat/1/file-${++seq}.png`
const png = (name: string, size = 1) =>
  new File(['x'.repeat(size)], name, { type: 'image/png', lastModified: seq })

describe('useAgentUpload', () => {
  beforeEach(() => {
    mockUpload.mockReset()
    mockUpload.mockImplementation(async () => uniqueUrl())
    mockDelete.mockReset()
    mockDelete.mockImplementation(async () => undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('uploads each file exactly once and returns urls', async () => {
    const f = png('a.png')
    const uploader = useAgentUpload()
    const { urls } = await uploader.uploadFiles([f])
    expect(mockUpload).toHaveBeenCalledTimes(1)
    expect(urls).toHaveLength(1)
  })

  it('keeps the uploaded object after a successful commit', async () => {
    const uploader = useAgentUpload()
    const { urls } = await uploader.uploadFiles([png('a.png')])

    uploader.commitSuccess(urls)

    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('releases the object when the message never reaches the server', async () => {
    const uploader = useAgentUpload()
    const { urls } = await uploader.uploadFiles([png('a.png')])

    uploader.commitFailure(urls)
    await Promise.resolve()

    expect(mockDelete).toHaveBeenCalledWith(urls[0])
  })

  // 缺陷：整批成功后才登记待删除，后面的文件一失败，前面已上传的就成了
  // COS 上无人引用的孤儿对象。
  it('rolls back earlier uploads when a later file in the same batch fails', async () => {
    const good = uniqueUrl()
    mockUpload
      .mockImplementationOnce(async () => good)
      .mockImplementationOnce(async () => {
        throw new Error('quota exceeded')
      })

    const uploader = useAgentUpload()
    await expect(uploader.uploadFiles([png('a.png'), png('b.png')]))
      .rejects.toThrow('quota exceeded')

    await vi.waitFor(() => expect(mockDelete).toHaveBeenCalledWith(good))
  })

  it('drops the deduplicated in-flight entry so a retry re-uploads', async () => {
    const f = png('retry.png')
    mockUpload.mockImplementationOnce(async () => {
      throw new Error('network down')
    })

    const uploader = useAgentUpload()
    await expect(uploader.uploadFiles([f])).rejects.toThrow('network down')
    await expect(uploader.uploadFiles([f])).resolves.toBeDefined()

    expect(mockUpload).toHaveBeenCalledTimes(2)
  })

  // 缺陷：并发批次通过 inFlight 去重共用同一个 URL，其中一个批次失败时
  // 若直接删除，会连带删掉另一个批次正要发送的附件。
  it('does not delete a url still held by another concurrent batch', async () => {
    const shared = uniqueUrl()
    let rejectB: (e: Error) => void = () => {}
    const fileA = png('same-a.png')
    const fileB = png('same-b.png')

    // 两个批次对同一个文件指纹上传一次，返回同一个 URL
    mockUpload.mockImplementation(async () => shared)

    const uploader = useAgentUpload()
    const batchA = uploader.uploadFiles([fileA])
    const batchB = uploader.uploadFiles([fileB])

    const [a, b] = await Promise.all([batchA, batchB])
    expect(a.urls[0]).toBe(shared)
    expect(b.urls[0]).toBe(shared)

    uploader.commitFailure(b.urls)
    await Promise.resolve()
    expect(mockDelete).not.toHaveBeenCalled()

    uploader.commitFailure(a.urls)
    await vi.waitFor(() => expect(mockDelete).toHaveBeenCalledWith(shared))
    expect(mockDelete).toHaveBeenCalledTimes(1)
  })

  // 已经被成功发送的消息引用的对象，不会被迟到的失败路径删掉
  it('never deletes an object already retained by a delivered message', async () => {
    const uploader = useAgentUpload()
    const { urls } = await uploader.uploadFiles([png('sent.png')])

    uploader.commitSuccess(urls)
    releaseAgentImage(urls[0])
    releaseAgentImage(urls[0])
    await Promise.resolve()

    expect(mockDelete).not.toHaveBeenCalled()
  })
})
