import { vi } from "vitest"

/**
 * Prism / Threads 生命周期测试用的浏览器桩。
 *
 * <p>jsdom 没有 WebGL2、rAF 调度、IntersectionObserver 回调与真实可见性状态，
 * 这里只模拟「引擎会调用到的接口」与「能观察到调度的开关」，不模拟像素。
 * 断言的是上下文创建次数、资源释放、排帧/停帧，不是画面。
 */

const LINK_STATUS = 0x8b82
const ACTIVE_UNIFORMS = 0x8b86

export type WebglStats = {
  programs: number
  deletedPrograms: number
  deletedTextures: number
  deletedVertexArrays: number
  draws: number
}

/** 一张能跑完整条渲染管线的假 WebGL2 上下文。 */
export function installFakeWebgl2() {
  const loseContext = vi.fn()
  const stats: WebglStats = {
    programs: 0,
    deletedPrograms: 0,
    deletedTextures: 0,
    deletedVertexArrays: 0,
    draws: 0,
  }

  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS,
    ACTIVE_UNIFORMS,
    TEXTURE_2D: 0x0de1,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    LINEAR: 0x2601,
    REPEAT: 0x2901,
    CLAMP_TO_EDGE: 0x812f,
    RGBA8: 0x8058,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    TRIANGLES: 0x0004,
    TRIANGLE_STRIP: 0x0005,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    FRAMEBUFFER: 0x8d40,
    COLOR_ATTACHMENT0: 0x8ce0,
    COLOR_BUFFER_BIT: 0x4000,
    BLEND: 0x0be2,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    NEAREST: 0x2600,
    TEXTURE0: 0x84c0,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => {
      stats.programs += 1
      return { program: stats.programs }
    }),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    deleteProgram: vi.fn(() => {
      stats.deletedPrograms += 1
    }),
    getProgramParameter: vi.fn((_program: unknown, pname: number) =>
      pname === LINK_STATUS ? true : 12,
    ),
    getActiveUniform: vi.fn((_program: unknown, index: number) => ({ name: `u${index}` })),
    getUniformLocation: vi.fn(() => ({})),
    createVertexArray: vi.fn(() => ({})),
    bindVertexArray: vi.fn(),
    deleteVertexArray: vi.fn(() => {
      stats.deletedVertexArrays += 1
    }),
    createTexture: vi.fn(() => ({})),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    texSubImage2D: vi.fn(),
    deleteTexture: vi.fn(() => {
      stats.deletedTextures += 1
    }),
    viewport: vi.fn(),
    useProgram: vi.fn(),
    uniform2f: vi.fn(),
    uniform3f: vi.fn(),
    uniform4f: vi.fn(),
    uniformMatrix3fv: vi.fn(),
    uniform1f: vi.fn(),
    uniform1i: vi.fn(),
    activeTexture: vi.fn(),
    drawArrays: vi.fn(() => {
      stats.draws += 1
    }),
    // Threads 用 instanced 画纤维带，并自己开一张离屏纹理做合成。
    drawArraysInstanced: vi.fn(() => {
      stats.draws += 1
    }),
    createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    deleteBuffer: vi.fn(),
    createFramebuffer: vi.fn(() => ({})),
    bindFramebuffer: vi.fn(),
    framebufferTexture2D: vi.fn(),
    deleteFramebuffer: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    blendFunc: vi.fn(),
    getExtension: vi.fn((name: string) =>
      name === "WEBGL_lose_context" ? { loseContext } : null,
    ),
  }

  // 颜色探针用一张 1×1 的 2D 画布；返回固定色即可。
  const probe = {
    clearRect: vi.fn(),
    fillStyle: "",
    fillRect: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([36, 87, 201, 255]) })),
  }

  const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext")
  getContext.mockImplementation(((type: string) => {
    if (type === "webgl2") return gl
    if (type === "2d") return probe
    return null
  }) as never)

  return {
    gl: gl as unknown as WebGL2RenderingContext,
    loseContext,
    stats,
    getContext,
    /** 只数 webgl2 上下文请求：换主题不应该再加一。 */
    webgl2Requests: () => getContext.mock.calls.filter(([type]) => type === "webgl2").length,
  }
}

/** 手动驱动的 rAF：排帧、取消、按需推进一帧。 */
export function installRafHarness() {
  let nextId = 0
  const pending = new Map<number, FrameRequestCallback>()

  const raf = vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextId
    pending.set(id, callback)
    return id
  })
  const cancel = vi.fn((id: number) => {
    pending.delete(id)
  })
  vi.stubGlobal("requestAnimationFrame", raf)
  vi.stubGlobal("cancelAnimationFrame", cancel)

  return {
    raf,
    cancel,
    /** 当前排着、还没执行的帧数。 */
    pending: () => pending.size,
    /** 执行本轮所有帧（执行中新排的帧留到下一轮）。 */
    flush(now = 16) {
      const batch = [...pending.values()]
      pending.clear()
      for (const callback of batch) callback(now)
    },
  }
}

/** 可控的 IntersectionObserver：手动派发「进/出视口」。 */
export function installIntersectionHarness() {
  const callbacks = new Set<IntersectionObserverCallback>()

  class FakeIntersectionObserver {
    readonly root = null
    readonly rootMargin = ""
    readonly thresholds: readonly number[] = []

    constructor(callback: IntersectionObserverCallback) {
      callbacks.add(callback)
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }

  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver)

  return {
    emit(isIntersecting: boolean) {
      for (const callback of callbacks) {
        callback(
          [{ isIntersecting } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        )
      }
    },
  }
}

/** 可控的页面可见性：切换 document.hidden 并派发 visibilitychange。 */
export function installVisibilityHarness() {
  let hidden = false
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  })

  return {
    set(next: boolean) {
      hidden = next
      document.dispatchEvent(new Event("visibilitychange"))
    },
    restore() {
      delete (document as unknown as Record<string, unknown>).hidden
    },
  }
}

/** 可控的 matchMedia：翻转 matches 并触发 change 监听。 */
export function installMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>()
  const state = { matches: initial }

  vi.stubGlobal("matchMedia", (query: string) => ({
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
  }))

  return {
    set(next: boolean) {
      state.matches = next
      listeners.forEach((listener) => listener())
    },
  }
}
