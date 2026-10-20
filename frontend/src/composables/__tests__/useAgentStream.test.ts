import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentStream } from '@/composables/useAgentStream'

const wrappers: VueWrapper[] = []
const transport = vi.fn<typeof fetch>()
const imageUrl = 'https://cos/agent-chat/1/retained.png'

function createStream() {
  let stream!: ReturnType<typeof useAgentStream>
  wrappers.push(mount({
    setup() {
      stream = useAgentStream()
      return () => null
    },
  }))
  return stream
}

describe('agent chat image lifecycle', () => {
  beforeEach(() => {
    transport.mockReset()
    vi.stubGlobal('fetch', transport)
  })

  afterEach(() => {
    wrappers.splice(0).forEach(wrapper => wrapper.unmount())
    vi.unstubAllGlobals()
  })

  it('retains uploaded images after a successful chat response', async () => {
    transport.mockResolvedValue(new Response(
      'data: {"messageType":"assistant","content":"Analysis complete"}\n\nevent: done\ndata: \n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    ))
    const stream = createStream()

    await stream.sendMessage('Analyze this image', 'thread-1', { urls: [imageUrl] })

    expect(transport).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toEqual({
      message: 'Analyze this image',
      threadId: 'thread-1',
      imageUrls: [imageUrl],
    })
    expect(stream.messages.value).toEqual([
      expect.objectContaining({ content: 'Analysis complete', isLoading: false }),
    ])
    expect(stream.isStreaming.value).toBe(false)
  })

  it('cleans uploaded images when opening the chat request fails', async () => {
    transport.mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
    transport.mockResolvedValue(new Response(null))
    const stream = createStream()

    await expect(stream.sendMessage('Analyze', 'thread-1', { urls: [imageUrl] }))
      .rejects.toThrow('Failed to open connection')

    expect(transport.mock.calls[1][0]).toMatch(/\/agent\/image\/upload\/delete$/)
    expect(JSON.parse(String(transport.mock.calls[1][1]?.body))).toEqual({ url: imageUrl })
    expect(stream.isStreaming.value).toBe(false)
  })

  it('cleans uploaded images when the user stops an unfinished response', async () => {
    transport.mockImplementationOnce(async (_input, init) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'data: {"messageType":"assistant","content":"Partial response"}\n\n',
        ))
        init?.signal?.addEventListener('abort', () => {
          controller.error(new DOMException('Aborted', 'AbortError'))
        })
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } }))
    transport.mockResolvedValue(new Response(null))
    const stream = createStream()
    const sending = stream.sendMessage('Analyze', 'thread-1', { urls: [imageUrl] })
    await vi.waitFor(() => expect(stream.messages.value).toHaveLength(1))

    stream.abort()
    await sending

    expect(transport.mock.calls[1]?.[0]).toMatch(/\/agent\/image\/upload\/delete$/)
    expect(JSON.parse(String(transport.mock.calls[1]?.[1]?.body))).toEqual({ url: imageUrl })
    expect(stream.isStreaming.value).toBe(false)
  })

  it('rejects server error events and cleans the uploaded image', async () => {
    transport.mockResolvedValueOnce(new Response(
      'event: error\ndata: 系统繁忙，请稍后重试\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    ))
    transport.mockResolvedValue(new Response(null))
    const stream = createStream()

    await expect(stream.sendMessage('Analyze', 'thread-1', { urls: [imageUrl] }))
      .rejects.toThrow('系统繁忙，请稍后重试')

    expect(transport.mock.calls[1]?.[0]).toMatch(/\/agent\/image\/upload\/delete$/)
    expect(JSON.parse(String(transport.mock.calls[1]?.[1]?.body))).toEqual({ url: imageUrl })
    expect(stream.isStreaming.value).toBe(false)
  })

  it('rejects an unfinished response when the connection closes without done', async () => {
    transport.mockResolvedValueOnce(new Response(
      'data: {"messageType":"assistant","content":"Incomplete analysis"}\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    ))
    transport.mockResolvedValue(new Response(null))
    const stream = createStream()

    await expect(stream.sendMessage('Analyze', 'thread-1', { urls: [imageUrl] }))
      .rejects.toThrow('Chat response ended before completion')

    expect(transport.mock.calls[1]?.[0]).toMatch(/\/agent\/image\/upload\/delete$/)
    expect(JSON.parse(String(transport.mock.calls[1]?.[1]?.body))).toEqual({ url: imageUrl })
    expect(stream.messages.value[0]).toMatchObject({ content: 'Incomplete analysis', isLoading: false })
    expect(stream.isStreaming.value).toBe(false)
  })
})
