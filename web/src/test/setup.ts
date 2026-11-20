/**
 * jsdom 缺的浏览器 API 垫片。
 *
 * <p>Base UI 的弹层/菜单会在挂载后测量尺寸、监听视口、判断动画偏好；jsdom 没有
 * 这些接口，缺了会在组件测试里直接抛 `not a function`。只补接口，不模拟布局：
 * 测试断言的是行为（焦点、Esc、aria），不是像素。
 */

if (typeof window !== "undefined") {
  const scope = window as unknown as Record<string, unknown>

  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  class IntersectionObserverStub {
    readonly root = null
    readonly rootMargin = ""
    readonly thresholds: readonly number[] = []
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }

  if (typeof scope.ResizeObserver !== "function") scope.ResizeObserver = ResizeObserverStub
  if (typeof scope.IntersectionObserver !== "function") {
    scope.IntersectionObserver = IntersectionObserverStub
  }

  if (typeof scope.matchMedia !== "function") {
    scope.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })
  }

  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = function scrollIntoView() {}
  }
}

export {}
