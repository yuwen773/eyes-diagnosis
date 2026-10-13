import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'

vi.mock('@microsoft/fetch-event-source', () => ({ fetchEventSource: vi.fn() }))
vi.mock('@/api/agentController', () => ({ deleteAgentImage: vi.fn(async () => undefined) }))

import { fetchEventSource } from '@microsoft/fetch-event-source'
import { deleteAgentImage } from '@/api/agentController'
import { useAgentStream } from '@/composables/useAgentStream'

function setup() {
  let stream!: ReturnType<typeof useAgentStream>
  const wrapper = mount(defineComponent({ setup() { stream = useAgentStream(); return () => null } }))
  return { stream, wrapper }
}

const delta = { event: '', data: JSON.stringify({ messageType: 'assistant', content: '半句回答' }), id: '' }

describe('chat stream terminal contract', () => {
  afterEach(() => vi.resetAllMocks())

  it('rejects an error event and never presents partial output as completed', async () => {
    vi.mocked(fetchEventSource).mockImplementationOnce(async (_url, options) => {
      options!.onmessage!(delta)
      options!.onmessage!({ event: 'error', data: '回答未完成', id: '' })
      options!.onclose!()
    })
    const { stream, wrapper } = setup()
    await expect(stream.sendMessage('问题', 'thread')).rejects.toThrow('回答未完成')
    expect(stream.messages.value.some(m => m.type === 'assistant')).toBe(false)
    expect(stream.messages.value.at(-1)).toMatchObject({ type: 'error', content: '回答未完成' })
    expect(stream.isStreaming.value).toBe(false)
    wrapper.unmount()
  })

  it('requires done and retains successfully claimed images', async () => {
    vi.mocked(fetchEventSource).mockImplementationOnce(async (_url, options) => {
      options!.onmessage!(delta)
      options!.onmessage!({ event: 'done', data: '', id: '' })
      options!.onclose!()
    })
    const { stream, wrapper } = setup()
    await stream.sendMessage('问题', 'thread', { urls: ['https://fixture/image.png'] })
    expect(stream.messages.value[0]).toMatchObject({ content: '半句回答', isLoading: false })
    expect(deleteAgentImage).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('rejects EOF without done', async () => {
    vi.mocked(fetchEventSource).mockImplementationOnce(async (_url, options) => {
      options!.onmessage!(delta)
      options!.onclose!()
    })
    const { stream, wrapper } = setup()
    await expect(stream.sendMessage('问题', 'thread')).rejects.toThrow('连接已中断')
    wrapper.unmount()
  })
})
