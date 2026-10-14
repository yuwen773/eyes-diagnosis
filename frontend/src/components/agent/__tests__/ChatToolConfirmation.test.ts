// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import ChatToolConfirmation from '../ChatToolConfirmation.vue'

afterEach(() => vi.unstubAllGlobals())

it('shows both versions and sends only the displayed consent binding', async () => {
  const row = { confirmationId: 'c1', sessionId: 's1', operationType: 'UPDATE_OWN_PROFILE',
    idempotencyKey: 'run1', contentDigest: 'a'.repeat(64), status: 'PENDING', expiresAt: '2099-01-01T00:00:00Z',
    content: { targetUserId: '7', before: { userProfile: '旧简介' }, after: { userProfile: '眼科学生' },
      source: { kind: 'internal', name: 'propose_profile_update' } } }
  const fetcher = vi.fn(async (_url, options) => ({ ok: true, json: async () => ({ code: 0,
    data: options?.method === 'POST' ? { ...row, status: 'APPROVED' } : [row] }) }))
  vi.stubGlobal('fetch', fetcher)
  const wrapper = mount(ChatToolConfirmation, { props: { sessionId: 's1', loading: false } })
  await flushPromises()
  expect(wrapper.text()).toContain('旧简介')
  expect(wrapper.text()).toContain('眼科学生')
  await wrapper.get('[data-action=approve]').trigger('click')
  await flushPromises()
  const call = fetcher.mock.calls.find(([, options]) => options?.method === 'POST')!
  expect(call[0]).toContain('/c1/approve')
  expect(JSON.parse(call[1].body)).toEqual({ idempotencyKey: 'run1', expectedContentDigest: 'a'.repeat(64) })
  expect(wrapper.text()).toContain('已批准')
  expect(wrapper.find('[data-action=approve]').exists()).toBe(false)
  wrapper.unmount()
})
