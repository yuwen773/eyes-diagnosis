/**
 * 颜色解析：canvas 组件共用的入口。
 *
 * canvas fillStyle / getImageData 只认 concrete 值，不吃 CSS 自定义属性——
 * `var(--signal)` 会被静默解析成黑。这里先做 probe 式解析，探测失败
 * （结果是不透明的黑）再向 getComputedStyle 要真实计算值回落一次。
 */

export type RGB = [number, number, number]

let probe: CanvasRenderingContext2D | null = null
const cache = new Map<string, RGB>()

function probeRgb(value: string): RGB | null {
  probe = probe ?? document.createElement("canvas").getContext("2d")
  if (!probe) return null
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = "#000000"
  probe.fillStyle = value
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data
  if (a === 0) return null
  return [r / 255, g / 255, b / 255]
}

function computedRgb(varName: string): RGB | null {
  const el = document.documentElement
  const raw = getComputedStyle(el).getPropertyValue(varName).trim()
  return raw ? probeRgb(raw) : null
}

/** 解析任意 CSS 颜色（含 var(...)）；失败时返回 fallback。 */
export function parseColor(value: string, fallback: RGB = [0, 0, 0]): RGB {
  const key = value
  const cached = cache.get(key)
  if (cached) return cached

  let rgb = probeRgb(value)

  // var(...) 落到黑（或解析失败）时，从 :root 拿自定义属性的真实值再试一次。
  if (!rgb || (rgb[0] === 0 && rgb[1] === 0 && rgb[2] === 0)) {
    const match = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value.trim())
    if (match) {
      rgb = computedRgb(match[1])
    }
  }

  const result = rgb ?? fallback
  cache.set(key, result)
  return result
}

/** 解析为 0–255 整数三元组（canvas 2D 组件用）。 */
export function parseColor255(value: string, fallback: RGB = [0, 0, 0]): [number, number, number] {
  const [r, g, b] = parseColor(value, fallback)
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}
