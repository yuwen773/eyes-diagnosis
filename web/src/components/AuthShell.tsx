import { useEffect, useRef, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { LaserFlow } from "@/components/LaserFlow"
import { Wordmark } from "@/components/shell/Wordmark"
import { useTheme } from "@/components/theme-provider"

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

/**
 * 认证台：一间暗着的检查室。
 *
 * 右边是一块磨砂玻璃做的凭据板，一束信号橙的读数光从上方落下，落在玻璃上沿，
 * 沿边缘铺开，再从两个角上溢下去。指针划过光束时，光里会浮出一张眼底影像——
 * 这套系统真正要读的东西。
 *
 * 玻璃需要背后有东西可糊，所以整页是暗的；亮着的部分全交给光。
 */
export function AuthShell({
  kicker,
  title,
  sub,
  children,
}: {
  kicker: string
  title: string
  sub: string
  children: ReactNode
}) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const glassRef = useRef<HTMLDivElement | null>(null)
  const [beam, setBeam] = useState(0.66)
  const [wide, setWide] = useState(false)

  // 窄屏放不下光柱，也不值得为它开一块 WebGL 上下文。
  useEffect(() => {
    const query = window.matchMedia("(min-width: 900px)")
    const update = () => setWide(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  // 光柱落在玻璃上沿偏左三分之一处，跟随布局变化重新对位。
  useEffect(() => {
    const update = () => {
      const stage = stageRef.current
      const glass = glassRef.current
      if (!stage || !glass) return
      const box = stage.getBoundingClientRect()
      const rect = glass.getBoundingClientRect()
      if (box.width <= 0 || rect.width <= 0) return
      const target = rect.left - box.left + rect.width * 0.34
      setBeam(clamp(target / box.width, 0.08, 0.92))
    }
    update()
    const observer = new ResizeObserver(update)
    const stage = stageRef.current
    const glass = glassRef.current
    if (stage) observer.observe(stage)
    if (glass) observer.observe(glass)
    window.addEventListener("resize", update)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", update)
    }
  }, [])

  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === "dark"

  return (
    <div className={"auth " + (dark ? "is-dark" : "is-field auth--light")} ref={stageRef}>
      {wide ? (
        <div className="auth__beam" aria-hidden="true">
          <LaserFlow
            surfaceRef={glassRef}
            beamPosition={beam}
            color="#ef7a45"
            intensity={0.62}
            beamWidth={0.5}
            flare={0.62}
            spread={0.7}
            spill={0.4}
            fog={0.09}
            dust={0.5}
            streaks={0.7}
            dots={0.45}
            pulse={0.5}
            speed={1.1}
            seed={5}
            mouseInteraction
            revealImage="/fundus-demo.jpg"
            revealRadius={210}
            revealOpacity={1}
            revealSize={620}
            theme={dark ? "dark" : "light"}
          />
        </div>
      ) : null}

      <div className="auth__grain" aria-hidden="true" />

      <div className="auth__grid">
        <aside className="auth__label">
          <div className="auth__brand">
            <Link to="/" aria-label="返回首页">
              <Wordmark />
            </Link>
            <span className="auth__code">AUTH · GATE</span>
          </div>

          <div className="auth__label-mid">
            <p className="auth__statement">
              每一次判读，
              <br />
              都留下可以核对的记录。
            </p>
            <p className="auth__statement-en">
              Every reading leaves a record worth checking.
            </p>
            <p className="auth__note">
              判读记录只在本人账号下可见。每条记录保留模型版本与权重指纹，供复核时核对。
            </p>
          </div>

          <div className="auth__ledger">
            <div>
              <span>会话</span>
              <b>SPRING SESSION · REDIS</b>
            </div>
            <div>
              <span>影像</span>
              <b>对象存储 · 私有读</b>
            </div>
            <div>
              <span>留痕</span>
              <b>模型版本 + 权重指纹</b>
            </div>
          </div>
        </aside>

        <main className="auth__panel">
          <div className="auth__stack">
            <div className="auth__glass" ref={glassRef} data-cursor="native">
              <div className="auth__glass-head">
                <span>Iris · AUTH GATE</span>
                <span className="auth__status">
                  <i />
                  待机
                </span>
              </div>

              <p className="overline">{kicker}</p>
              <h1 className="auth__title">{title}</h1>
              <p className="auth__sub">{sub}</p>
              {children}
            </div>

            <p className="auth__caption">指针划过光束 · 光里显出眼底影像</p>
          </div>
        </main>
      </div>
    </div>
  )
}
