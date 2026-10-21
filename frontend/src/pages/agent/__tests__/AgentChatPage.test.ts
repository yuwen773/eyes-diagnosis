import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

vi.mock('@/api/agentController', () => ({
  getChatHistory: vi.fn(async () => ({ data: { messages: [] } })),
  getSessions: vi.fn(async () => ({ data: [] })),
  generateTitle: vi.fn(async () => ({ data: true })),
  uploadAgentImage: vi.fn(async () => 'https://cos/agent-chat/1/u.png'),
  deleteAgentImage: vi.fn(async () => undefined),
}))

const stream = {
  messages: ref<any[]>([]),
  isStreaming: ref(false),
  sendMessage: vi.fn(async () => undefined),
  pushMessage: vi.fn((msg: any) => { stream.messages.value.push(msg) }),
  reset: vi.fn(() => { stream.messages.value = [] }),
  abort: vi.fn(),
}

vi.mock('@/composables/useAgentStream', () => ({
  useAgentStream: () => stream,
}))

import { generateTitle, getChatHistory } from '@/api/agentController'
import AgentChatPage from '@/pages/agent/AgentChatPage.vue'

const THREAD_ID_KEY = 'agent_current_thread_id'

function mountPage() {
  return mount(AgentChatPage, {
    global: {
      stubs: {
        AgentChatLayout: { template: '<div><slot name="left" /><slot name="center" /><slot name="right" /></div>' },
        LeftSidebar: true,
        AgentMessageList: true,
        AgentChatInput: true,
        AgentResourcePanel: true,
        ImagePreview: true,
        SettingsModal: true,
      },
    },
  })
}

describe('AgentChatPage thread lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
    stream.messages.value = []
    stream.isStreaming.value = false
    vi.clearAllMocks()
    stream.sendMessage.mockResolvedValue(undefined)
  })

  afterEach(() => {
    localStorage.clear()
  })

  // 缺陷：onMounted 无条件用已保存的 threadId 覆盖初始值。没有保存值时
  // 拿空串覆盖，首条消息就以空 threadId 发出——后端新建一个会话，前端
  // 却把消息挂在这个空 id 上，两边从此分叉。
  it('keeps the generated thread id when nothing is saved', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const input = wrapper.findComponent({ name: 'AgentChatInput' })
    input.vm.$emit('send', '第一次提问', [])
    await flushPromises()

    expect(stream.sendMessage).toHaveBeenCalledTimes(1)
    const threadId = stream.sendMessage.mock.calls[0][1]
    expect(threadId).toBeTruthy()
    expect(threadId).not.toBe('')
  })

  it('restores the saved thread id', async () => {
    localStorage.setItem(THREAD_ID_KEY, 'saved-thread')
    const wrapper = mountPage()
    await flushPromises()

    const input = wrapper.findComponent({ name: 'AgentChatInput' })
    input.vm.$emit('send', '继续之前的对话', [])
    await flushPromises()

    expect(stream.sendMessage.mock.calls[0][1]).toBe('saved-thread')
    expect(getChatHistory).toHaveBeenCalledWith('saved-thread', undefined, 100)
  })

  // 缺陷：判断 messages.length === 0 发生在 pushMessage 之后，此时用户
  // 消息已经进列表，条件恒为假，标题永远不会生成。
  it('generates a title for the first message only', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const input = wrapper.findComponent({ name: 'AgentChatInput' })

    input.vm.$emit('send', '第一条', [])
    await flushPromises()
    expect(generateTitle).toHaveBeenCalledTimes(1)
    expect(generateTitle).toHaveBeenCalledWith(expect.any(String), '第一条')

    input.vm.$emit('send', '第二条', [])
    await flushPromises()
    expect(generateTitle).toHaveBeenCalledTimes(1)
  })

  it('does not generate a title when restoring an existing conversation', async () => {
    // 已存在的会话必然带有至少一条历史消息
    vi.mocked(getChatHistory).mockResolvedValueOnce({
      data: {
        messages: [
          { role: 'USER', content: '之前的问题', createdTime: '2026-10-20T10:00:00Z' },
        ],
      },
    } as any)
    localStorage.setItem(THREAD_ID_KEY, 'saved-thread')
    const wrapper = mountPage()
    await flushPromises()

    const input = wrapper.findComponent({ name: 'AgentChatInput' })
    input.vm.$emit('send', '追问', [])
    await flushPromises()

    expect(generateTitle).not.toHaveBeenCalled()
  })
})
