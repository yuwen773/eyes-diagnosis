// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { mountBeams, type BeamsSettings } from "./beamsMount"

/**
 * jsdom 没有 WebGL。这里用一个记录调用的假上下文，验的是**生命周期契约**，
 * 不是像素：谁在什么时候被创建、被回收，循环什么时候停。
 */

const GL = {
  VERTEX_SHADER: 0x8b31,
  FRAGMENT_SHADER: 0x8b30,
  COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82,
  ACTIVE_UNIFORMS: 0x8b86,
  ARRAY_BUFFER: 0x8892,
  STATIC_DRAW: 0x88e4,
  FLOAT: 0x1406,
  TEXTURE_2D: 0x0de1,
  RGBA8: 0x8058,
  RGBA16F: 0x881a,
  LINEAR_MIPMAP_LINEAR: 0x2703,
  LINEAR: 0x2601,
  CLAMP_TO_EDGE: 0x812f,
  FRAMEBUFFER: 0x8d40,
  COLOR_ATTACHMENT0: 0x8ce0,
  TRIANGLES: 0x0004,
  TEXTURE0: 0x84c0,
}

function fakeContext(options: { lost?: () => boolean } = {}) {
  const calls: string[] = []
  const base: Record<string, unknown> = {
    ...GL,
    isContextLost: () => options.lost?.() ?? false,
    getExtension: vi.fn(() => null),
    getShaderParameter: vi.fn(() => true),
    getProgramParameter: vi.fn((_program: unknown, pname: number) =>
      pname === GL.ACTIVE_UNIFORMS ? 0 : true,
    ),
    createShader: () => ({}),
    createProgram: () => ({}),
    createBuffer: () => ({}),
    createVertexArray: () => ({}),
    createTexture: () => ({}),
    createFramebuffer: () => ({}),
    drawArrays: vi.fn(() => calls.push("drawArrays")),
    deleteProgram: vi.fn(() => calls.push("deleteProgram")),
    deleteTexture: vi.fn(),
    deleteFramebuffer: vi.fn(),
    deleteBuffer: vi.fn(),
    deleteVertexArray: vi.fn(),
  }

  const proxy = new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop as string]
      if (typeof prop !== "string") return undefined
      return () => calls.push(prop)
    },
  })

  return { gl: proxy as unknown as WebGL2RenderingContext, calls, base }
}

/** 手动驱动的 rAF：让「循环停了没有」变成可断言的事实。 */
let frameQueue: FrameRequestCallback[] = []
let nextFrameId = 0

function runFrames(count: number) {
  for (let i = 0; i < count; i += 1) {
    const pending = frameQueue
    frameQueue = []
    for (const callback of pending) callback(performance.now() + i * 16)
  }
}

function settings(patch: Partial<BeamsSettings> = {}): BeamsSettings {
  return {
    color: "#3f7fd6",
    beamWidth: 240,
    rotation: 24,
    speed: 0.75,
    waveLength: 320,
    depth: 1.15,
    sharpness: 0.7,
    twist: 0.18,
    fillLight: 0.55,
    glow: 0.8,
    brightness: 1.25,
    variation: 0.35,
    grain: 0.22,
    quality: 0.75,
    mouseInteraction: false,
    mouseStrength: 0.7,
    intro: false,
    fade: 0.1,
    opacity: 1,
    lightMode: true,
    paused: false,
    dpr: 1,
    ...patch,
  }
}

const originalGetContext = HTMLCanvasElement.prototype.getContext

function setup(options: { lost?: () => boolean } = {}) {
  const { gl, calls, base } = fakeContext(options)
  HTMLCanvasElement.prototype.getContext = function getContext(type: string) {
    if (type === "webgl2") return gl
    return null
  } as typeof HTMLCanvasElement.prototype.getContext

  const canvas = document.createElement("canvas")
  const container = document.createElement("div")
  document.body.append(container)
  container.append(canvas)

  return { canvas, container, gl, calls, base }
}

function motionQuery(initial: boolean) {
  const listeners = new Set<() => void>()
  const state = { matches: initial }
  window.matchMedia = ((query: string) => ({
    get matches() {
      return state.matches
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia

  return {
    set(next: boolean) {
      state.matches = next
      listeners.forEach((listener) => listener())
    },
    listenerCount: () => listeners.size,
  }
}

const originalMatchMedia = window.matchMedia

beforeEach(() => {
  frameQueue = []
  nextFrameId = 0
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frameQueue.push(callback)
    nextFrameId += 1
    return nextFrameId
  })
  vi.stubGlobal("cancelAnimationFrame", () => {
    frameQueue = []
  })
})

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext
  window.matchMedia = originalMatchMedia
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})

describe("mountBeams 生命周期", () => {
  it("dispose 不主动丢上下文：同一张 canvas 还要被 StrictMode 再挂一次", () => {
    const { canvas, container, base } = setup()
    const engine = mountBeams({
      canvas,
      container,
      getSettings: () => settings(),
    })

    engine!.dispose()

    expect(base.getExtension).not.toHaveBeenCalledWith("WEBGL_lose_context")
    // 自己建的资源照样回收。
    expect(base.deleteProgram).toHaveBeenCalledTimes(2)
    expect(base.deleteFramebuffer).toHaveBeenCalledTimes(1)
  })

  it("dispose 是幂等的，之后 wake 也不会再把循环叫起来", () => {
    const { canvas, container, base } = setup()
    const engine = mountBeams({ canvas, container, getSettings: () => settings() })!

    engine.dispose()
    const drawCalls = (base.drawArrays as ReturnType<typeof vi.fn>).mock.calls.length
    frameQueue = []

    engine.dispose()
    engine.wake()
    runFrames(3)

    expect(frameQueue).toHaveLength(0)
    expect((base.drawArrays as ReturnType<typeof vi.fn>).mock.calls.length).toBe(drawCalls)
    expect(base.deleteFramebuffer).toHaveBeenCalledTimes(1)
  })

  it("拿到一个已经丢了的上下文就放弃，让外面走静态降级", () => {
    const { canvas, container } = setup({ lost: () => true })

    expect(mountBeams({ canvas, container, getSettings: () => settings() })).toBeNull()
  })

  it("运行中打开「减少动态效果」会停下循环，关掉之后恢复", () => {
    const media = motionQuery(false)
    const { canvas, container, base } = setup()
    const engine = mountBeams({ canvas, container, getSettings: () => settings() })!
    const draws = () => (base.drawArrays as ReturnType<typeof vi.fn>).mock.calls.length

    runFrames(4)
    const live = draws()
    expect(live).toBeGreaterThan(1)

    media.set(true)
    runFrames(4)
    const paused = draws()
    // 停下来之后不再自增。
    runFrames(4)
    expect(draws()).toBe(paused)

    media.set(false)
    runFrames(4)
    expect(draws()).toBeGreaterThan(paused)

    engine.dispose()
  })

  it("dispose 之后把系统动效监听也摘掉", () => {
    const media = motionQuery(false)
    const { canvas, container } = setup()
    const engine = mountBeams({ canvas, container, getSettings: () => settings() })!

    expect(media.listenerCount()).toBe(1)
    engine.dispose()
    expect(media.listenerCount()).toBe(0)
  })
})
