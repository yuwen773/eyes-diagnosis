import { useEffect, useMemo, useRef, type CSSProperties, type ReactElement } from "react"

import "./Prism.css"

/**
 * Prism —— React Bits 的 WebGL2 棱镜光场，vendored 副本。
 *
 * <p>来源：https://github.com/DavidHDev/react-bits 的 Prism 组件，
 * MIT + Commons Clause License Condition v1.0，Copyright (c) 2026 David Haz。
 * 许可与取用记录见同目录 `THIRD-PARTY-NOTICES.md`。
 *
 * <p>上游是 JavaScript + CSS 版本，这里做了四件事：
 * <ul>
 *   <li>补 TypeScript 类型，纳入 `tsc -b` 门禁；</li>
 *   <li>`prefers-reduced-motion` 改为**实时订阅**（上游只在挂载时读一次）；</li>
 *   <li>补 `onUnavailable`：WebGL2 不可用、着色器编译失败、上下文丢失时
 *       由调用方切到静态画面；</li>
 *   <li>不在 cleanup 里无条件丢上下文——StrictMode 的假卸载会立刻复用同一张
 *       canvas，无条件 `loseContext()` 会把刚建好的新上下文一起弄丢。</li>
 * </ul>
 *
 * <p>画布是纯装饰：`aria-hidden`，不承载任何信息。
 */

const INTRO_SECONDS = 1.4
const PALETTE_SIZE = 64
const HUE_W = [0.299, 0.587, 0.114, 0.299, 0.587, 0.114, 0.299, 0.587, 0.114]
const HUE_U = [0.701, -0.587, -0.114, -0.299, 0.413, -0.114, -0.3, -0.588, 0.886]
const HUE_V = [0.168, -0.331, 0.5, 0.328, 0.035, -0.5, -0.497, 0.296, 0.201]

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform mat3 uRay;
uniform float uGlow;
uniform vec2 uOffset;
uniform float uColorFreq;
uniform float uCenterShift;
uniform float uInvBaseHalf;
uniform float uInvHeight;
uniform float uMinAxis;
uniform float uPxScale;
uniform sampler2D uPalette;
uniform int uUsePalette;
uniform float uTime;
uniform float uNoise;
uniform float uSaturation;
uniform mat3 uHue;
uniform int uUseHue;
uniform float uLight;
uniform float uNeutral;
out vec4 outColor;

const vec4 PHASE_COS = vec4(1.0, 0.5403023058681398, -0.4161468365471424, -0.9899924966004454);
const vec4 PHASE_SIN = vec4(0.0, 0.8414709848078965, 0.9092974268256817, 0.1411200080598672);

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453123);
}

float pyramid(vec3 p) {
  vec3 q = vec3(abs(p.x) * uInvBaseHalf, abs(p.y) * uInvHeight, abs(p.z) * uInvBaseHalf);
  return max((q.x + q.y + q.z - 1.0) * uMinAxis * 0.5773502691896258, -p.y);
}

vec3 grade(vec3 col, vec2 seed) {
  col += (rand(seed) - 0.5) * uNoise;
  col = clamp(col, 0.0, 1.0);
  float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = clamp(mix(vec3(L), col, uSaturation), 0.0, 1.0);
  if (uUseHue == 1) col = clamp(uHue * col, 0.0, 1.0);
  return col;
}

void main() {
  vec2 f = (gl_FragCoord.xy - 0.5 * uResolution - uOffset) * uPxScale;
  vec3 origin = uRay * vec3(f, 0.0);
  vec3 axis = uRay[2];
  float z = 5.0;
  vec4 o = vec4(0.0);
  for (int i = 0; i < 100; i++) {
    vec3 p = origin + axis * z;
    float d = 0.1 + 0.2 * abs(pyramid(p + vec3(0.0, uCenterShift, 0.0)));
    z -= d;
    float phase = (p.y + z) * uColorFreq;
    vec4 band = sin(phase) * PHASE_COS + cos(phase) * PHASE_SIN + 1.0;
    if (uUsePalette == 1) band.rgb = texture(uPalette, vec2(phase * 0.15915494309189535, 0.5)).rgb * 2.0;
    o += band / d;
  }
  vec4 raw = o * o * uGlow / 1e5;
  vec4 e = exp(2.0 * raw);
  vec4 mapped = (e - 1.0) / (e + 1.0);
  vec2 seed = gl_FragCoord.xy + vec2(uTime);
  if (uLight > 0.5) {
    float peak = max(raw.r, max(raw.g, raw.b));
    vec3 hue = grade(raw.rgb / max(peak, 1e-6), seed);
    vec3 ink = pow(hue, vec3(1.5)) * mix(0.86, 0.32, uNeutral);
    float strength = max(mapped.r, max(mapped.g, mapped.b)) * mapped.a;
    float cover = clamp(strength * 0.95 + (rand(seed.yx) - 0.5) * uNoise * 0.5, 0.0, 1.0);
    outColor = vec4(ink * cover, cover);
  } else {
    outColor = vec4(grade(mapped.rgb, seed) * mapped.a, mapped.a);
  }
}`

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const compile = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  gl.deleteShader(shader)
  return null
}

type Linked = {
  program: WebGLProgram
  uniforms: Record<string, WebGLUniformLocation | null>
}

const link = (gl: WebGL2RenderingContext): Linked | null => {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT)
  const program = gl.createProgram()
  if (!vertex || !fragment || !program) return null
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }
  const uniforms: Record<string, WebGLUniformLocation | null> = {}
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i)
    if (info) uniforms[info.name] = gl.getUniformLocation(program, info.name)
  }
  return { program, uniforms }
}

const rotation = (yaw: number, pitch: number, roll: number) => {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cx = Math.cos(pitch)
  const sx = Math.sin(pitch)
  const cz = Math.cos(roll)
  const sz = Math.sin(roll)
  return [
    cy * cz + sy * sx * sz,
    cx * sz,
    -sy * cz + cy * sx * sz,
    -cy * sz + sy * sx * cz,
    cx * cz,
    sy * sz + cy * sx * cz,
    sy * cx,
    -sx,
    cy * cx,
  ]
}

const multiply = (a: number[], b: number[]) => {
  const out = new Array<number>(9)
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      out[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2]
    }
  }
  return out
}

export type PrismAnimationType = "rotate" | "3drotate" | "rotate3d" | "hover" | "static"

export type PrismProps = {
  height?: number
  baseWidth?: number
  animationType?: PrismAnimationType
  glow?: number
  offset?: { x?: number; y?: number }
  noise?: number
  scale?: number
  hueShift?: number
  colorFrequency?: number
  colors?: string[]
  saturation?: number
  timeScale?: number
  interactive?: boolean
  hoverStrength?: number
  inertia?: number
  intro?: boolean
  resolution?: number
  lightMode?: boolean
  dpr?: number
  className?: string
  style?: CSSProperties
  /** WebGL2 不可用 / 着色器失败 / 上下文丢失时通知调用方切静态降级。 */
  onUnavailable?: () => void
}

type Settings = {
  height: number
  baseWidth: number
  animationType: "rotate" | "3drotate" | "hover" | "static"
  glow: number
  offsetX: number
  offsetY: number
  noise: number
  scale: number
  hueShift: number
  colorFrequency: number
  colors: string[]
  colorsKey: string
  saturation: number
  timeScale: number
  interactive: boolean
  hoverStrength: number
  inertia: number
  intro: boolean
  resolution: number
  lightMode: boolean
  dpr?: number
}

export function Prism({
  height = 3.5,
  baseWidth = 5.5,
  animationType = "rotate",
  glow = 1,
  offset,
  noise = 0,
  scale = 3.6,
  hueShift = 0,
  colorFrequency = 1,
  colors,
  saturation = 1.5,
  timeScale = 0.5,
  interactive = true,
  hoverStrength = 2,
  inertia = 0.05,
  intro = true,
  resolution = 0.5,
  lightMode = false,
  dpr,
  className = "",
  style,
  onUnavailable,
}: PrismProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wakeRef = useRef<(() => void) | null>(null)
  const releaseRef = useRef(0)
  const unavailableRef = useRef(onUnavailable)

  const palette = useMemo(
    () => (Array.isArray(colors) ? colors.filter(Boolean).slice(0, 8) : []),
    [colors],
  )
  const colorsKey = palette.join(",")

  const settings = useMemo<Settings>(
    () => ({
      height: Math.max(0.1, height),
      baseWidth: Math.max(0.1, baseWidth),
      animationType: animationType === "rotate3d" ? "3drotate" : animationType,
      glow: Math.max(0, glow),
      offsetX: offset?.x ?? 0,
      offsetY: offset?.y ?? 0,
      noise: Math.max(0, noise),
      scale: Math.max(0.1, scale),
      hueShift: ((hueShift || 0) * Math.PI) / 180,
      colorFrequency: Math.max(0, colorFrequency),
      colors: palette,
      colorsKey,
      saturation: Math.max(0, saturation),
      timeScale: Math.max(0, timeScale),
      interactive,
      hoverStrength: Math.max(0, hoverStrength),
      inertia: clamp(inertia, 0.001, 1),
      intro,
      resolution: clamp(resolution, 0.25, 1),
      lightMode,
      dpr,
    }),
    [
      height,
      baseWidth,
      animationType,
      glow,
      offset?.x,
      offset?.y,
      noise,
      scale,
      hueShift,
      colorFrequency,
      palette,
      colorsKey,
      saturation,
      timeScale,
      interactive,
      hoverStrength,
      inertia,
      intro,
      resolution,
      lightMode,
      dpr,
    ],
  )
  const settingsRef = useRef(settings)

  useEffect(() => {
    unavailableRef.current = onUnavailable
  }, [onUnavailable])

  useEffect(() => {
    settingsRef.current = settings
    wakeRef.current?.()
  }, [settings])

  useEffect(() => {
    window.clearTimeout(releaseRef.current)
    const container = containerRef.current
    const canvas = canvasRef.current
    const gl = canvas?.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
    })
    if (!container || !canvas || !gl) {
      unavailableRef.current?.()
      return undefined
    }
    const shader = link(gl)
    if (!shader) {
      unavailableRef.current?.()
      return undefined
    }
    const u = shader.uniforms
    const vao = gl.createVertexArray()
    const paletteTexture = gl.createTexture()
    if (!vao || !paletteTexture) {
      unavailableRef.current?.()
      return undefined
    }
    gl.bindTexture(gl.TEXTURE_2D, paletteTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, PALETTE_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)

    const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
    const parse = (value: string): [number, number, number] => {
      if (!probe) return [255, 255, 255]
      probe.clearRect(0, 0, 1, 1)
      probe.fillStyle = "#000000"
      probe.fillStyle = String(value)
      probe.fillRect(0, 0, 1, 1)
      const [r, g, b] = probe.getImageData(0, 0, 1, 1).data
      return [r, g, b]
    }
    let paletteKey = ""
    let neutral = 0
    const syncPalette = (colorsList: string[]) => {
      const key = colorsList.join(",")
      if (key === paletteKey) return
      paletteKey = key
      neutral = 0
      if (!colorsList.length) return
      const stops = colorsList.map(parse)
      neutral =
        1 -
        stops.reduce((sum, [r, g, b]) => {
          const top = Math.max(r, g, b)
          return sum + (top > 0 ? (top - Math.min(r, g, b)) / top : 0)
        }, 0) /
          stops.length
      const data = new Uint8Array(PALETTE_SIZE * 4)
      for (let i = 0; i < PALETTE_SIZE; i++) {
        const position = (i / PALETTE_SIZE) * stops.length
        const index = Math.floor(position)
        const a = stops[index % stops.length]
        const b = stops[(index + 1) % stops.length]
        const t = position - index
        const k = t * t * (3 - 2 * t)
        for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(a[c] + (b[c] - a[c]) * k)
        data[i * 4 + 3] = 255
      }
      gl.bindTexture(gl.TEXTURE_2D, paletteTexture)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PALETTE_SIZE, 1, gl.RGBA, gl.UNSIGNED_BYTE, data)
    }

    const motionQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null
    let reduce = motionQuery?.matches ?? false
    const view = { width: 1, height: 1, scale: 1 }
    const pose = { yaw: 0, pitch: 0, roll: 0 }
    const pointer = { x: 0, y: 0, inside: false }
    let time = 0
    let introClock = settingsRef.current.intro && !reduce ? 0 : 1
    let raf = 0
    let last = 0
    let visible = true

    const orientation = (s: Settings) => {
      const tilt = rotation(pose.yaw, pose.pitch, pose.roll)
      if (s.animationType === "rotate") {
        const t = time * s.timeScale
        const c0 = Math.cos(t)
        const c1 = Math.cos(t + 33)
        const c2 = Math.cos(t + 11)
        return multiply(tilt, [c0, 0, c2, 0, 1, 0, c1, 0, c0])
      }
      if (s.animationType === "3drotate") {
        const t = time * s.timeScale
        return multiply(
          tilt,
          rotation(t * 0.55, Math.sin(t * 0.6 + 0.6) * 0.6, Math.sin(t * 0.35 + 1.9) * 0.5),
        )
      }
      return tilt
    }

    const draw = () => {
      const s = settingsRef.current
      syncPalette(s.colors)
      const half = s.baseWidth * 0.5
      const ignite = introClock * introClock * (3 - 2 * introClock)
      const c = Math.cos(s.hueShift)
      const sn = Math.sin(s.hueShift)
      gl.bindVertexArray(vao)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.useProgram(shader.program)
      gl.uniform2f(u.uResolution ?? null, canvas.width, canvas.height)
      gl.uniformMatrix3fv(u.uRay ?? null, false, orientation(s))
      gl.uniform1f(u.uGlow ?? null, s.glow * ignite * ignite)
      gl.uniform2f(u.uOffset ?? null, s.offsetX * view.scale, -s.offsetY * view.scale)
      gl.uniform1f(u.uColorFreq ?? null, s.colorFrequency)
      gl.uniform1f(u.uCenterShift ?? null, s.height * 0.25)
      gl.uniform1f(u.uInvBaseHalf ?? null, 1 / half)
      gl.uniform1f(u.uInvHeight ?? null, 1 / s.height)
      gl.uniform1f(u.uMinAxis ?? null, Math.min(half, s.height))
      gl.uniform1f(u.uPxScale ?? null, 1 / (canvas.height * 0.1 * s.scale))
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, paletteTexture)
      gl.uniform1i(u.uPalette ?? null, 0)
      gl.uniform1i(u.uUsePalette ?? null, s.colors.length ? 1 : 0)
      gl.uniform1f(u.uTime ?? null, time)
      gl.uniform1f(u.uNoise ?? null, s.noise)
      gl.uniform1f(u.uSaturation ?? null, s.saturation)
      gl.uniformMatrix3fv(
        u.uHue ?? null,
        false,
        HUE_W.map((w, i) => w + HUE_U[i] * c + HUE_V[i] * sn),
      )
      gl.uniform1i(u.uUseHue ?? null, Math.abs(s.hueShift) > 0.0001 ? 1 : 0)
      gl.uniform1f(u.uLight ?? null, s.lightMode ? 1 : 0)
      gl.uniform1f(u.uNeutral ?? null, neutral)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    const frame = (now: number) => {
      raf = 0
      if (!visible || document.hidden) return
      const s = settingsRef.current
      const maxDpr = Math.min(s.dpr || window.devicePixelRatio || 1, 2)
      if (Math.round(view.width * maxDpr * s.resolution) !== canvas.width) {
        resize()
        return
      }
      const dt = last ? clamp((now - last) / 1000, 0.001, 0.05) : 1 / 60
      last = now
      if (!reduce) time += dt
      if (introClock < 1) introClock = Math.min(1, introClock + dt / INTRO_SECONDS)
      const hover = s.animationType === "hover"
      const aim = pointer.inside && !reduce && (hover || s.interactive)
      const reach = (hover ? 0.6 : 0.09) * s.hoverStrength
      const yaw = aim ? -pointer.x * reach : 0
      const pitch = aim ? pointer.y * reach : 0
      const follow = 1 - Math.pow(1 - s.inertia, dt * 60)
      pose.yaw += (yaw - pose.yaw) * follow
      pose.pitch += (pitch - pose.pitch) * follow
      pose.roll += (0 - pose.roll) * (1 - Math.pow(0.9, dt * 60))
      draw()
      const settling =
        Math.abs(yaw - pose.yaw) + Math.abs(pitch - pose.pitch) + Math.abs(pose.roll) > 1e-4
      const spinning = !reduce && !hover && s.animationType !== "static" && s.timeScale > 0
      const busy = spinning || settling || introClock < 1 || (!reduce && s.noise > 0)
      if (busy) raf = requestAnimationFrame(frame)
      else last = 0
    }

    function wake() {
      if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame)
    }

    const resize = () => {
      const s = settingsRef.current
      view.width = Math.max(1, container.clientWidth)
      view.height = Math.max(1, container.clientHeight)
      view.scale = Math.min(s.dpr || window.devicePixelRatio || 1, 2) * s.resolution
      canvas.width = Math.max(1, Math.round(view.width * view.scale))
      canvas.height = Math.max(1, Math.round(view.height * view.scale))
      draw()
      wake()
    }

    // 高刷鼠标的 pointermove 每秒可达上千次，而每次 getBoundingClientRect 都可能
    // 强制布局。合帧到每帧最多读一次；坐标取最后一次事件，手感没有差别。
    let moveRaf = 0
    let pendingX = 0
    let pendingY = 0
    const applyPointer = () => {
      moveRaf = 0
      const rect = container.getBoundingClientRect()
      const x = ((pendingX - rect.left) / Math.max(1, rect.width)) * 2 - 1
      const y = ((pendingY - rect.top) / Math.max(1, rect.height)) * 2 - 1
      pointer.inside = Math.abs(x) <= 1 && Math.abs(y) <= 1
      pointer.x = clamp(x, -1, 1)
      pointer.y = clamp(y, -1, 1)
      const s = settingsRef.current
      if (s.interactive || s.animationType === "hover") wake()
    }

    const onPointerMove = (event: PointerEvent) => {
      pendingX = event.clientX
      pendingY = event.clientY
      if (!moveRaf) moveRaf = requestAnimationFrame(applyPointer)
    }

    const onPointerLeave = () => {
      pointer.inside = false
      wake()
    }

    const onVisibility = () => {
      last = 0
      wake()
    }

    const onMotionPreference = () => {
      reduce = motionQuery?.matches ?? false
      if (reduce) introClock = 1
      last = 0
      wake()
    }

    const onContextLost = (event: Event) => {
      event.preventDefault()
      unavailableRef.current?.()
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)
    const intersection = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting)
      if (visible) {
        last = 0
        wake()
      }
    })
    intersection.observe(container)
    window.addEventListener("pointermove", onPointerMove, { passive: true })
    window.addEventListener("blur", onPointerLeave)
    document.documentElement.addEventListener("pointerleave", onPointerLeave)
    document.addEventListener("visibilitychange", onVisibility)
    motionQuery?.addEventListener("change", onMotionPreference)
    canvas.addEventListener("webglcontextlost", onContextLost)
    resize()
    wakeRef.current = wake

    return () => {
      cancelAnimationFrame(raf)
      if (moveRaf) cancelAnimationFrame(moveRaf)
      wakeRef.current = null
      resizeObserver.disconnect()
      intersection.disconnect()
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("blur", onPointerLeave)
      document.documentElement.removeEventListener("pointerleave", onPointerLeave)
      document.removeEventListener("visibilitychange", onVisibility)
      motionQuery?.removeEventListener("change", onMotionPreference)
      canvas.removeEventListener("webglcontextlost", onContextLost)
      gl.deleteTexture(paletteTexture)
      gl.deleteVertexArray(vao)
      gl.deleteProgram(shader.program)
      // StrictMode 的假卸载会立刻用同一张 canvas 再挂一次；等下一轮事件循环
      // 确认 canvas 真的离开文档了，才丢上下文。
      releaseRef.current = window.setTimeout(() => {
        if (!canvas.isConnected) gl.getExtension("WEBGL_lose_context")?.loseContext()
      }, 0)
    }
  }, [])

  const classes = ["prism", className].filter(Boolean).join(" ")

  return (
    <div ref={containerRef} className={classes} style={style}>
      <canvas ref={canvasRef} className="prism-canvas" aria-hidden="true" />
    </div>
  )
}

export default Prism
