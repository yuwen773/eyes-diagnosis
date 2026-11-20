import { useEffect, useRef, useState } from "react"
import { Maximize, Minus, Plus, RotateCcw, X } from "lucide-react"
import { Dialog } from "@/components/ui/dialog"
import { reviewApi } from "@/lib/reviewApi"

type ImageState = { url: string } | "loading" | "unavailable"
const minimum = 1
const maximum = 3

export function AuthorizedRunImage({ runId }: { runId: string }) {
  const [image, setImage] = useState<ImageState>("loading")
  const [open, setOpen] = useState(false)
  const [scale, setScale] = useState(minimum)
  const [full, setFull] = useState(false)
  const [viewerError, setViewerError] = useState(false)
  const fullscreen = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let controller: AbortController | undefined
    let ownedUrl: string | undefined
    function clear() {
      controller?.abort()
      if (ownedUrl) URL.revokeObjectURL(ownedUrl)
      ownedUrl = undefined
    }
    function load() {
      clear()
      const request = new AbortController()
      controller = request
      setImage("loading")
      void reviewApi
        .image(runId, request.signal)
        .then((blob) => {
          if (request.signal.aborted) return
          ownedUrl = URL.createObjectURL(blob)
          setImage({ url: ownedUrl })
        })
        .catch(() => {
          if (!request.signal.aborted) setImage("unavailable")
        })
    }
    function visibility() {
      if (document.hidden) {
        clear()
        setImage("loading")
        setOpen(false)
      } else {
        load()
      }
    }
    function fullscreenChanged() {
      setFull(document.fullscreenElement === fullscreen.current)
    }
    if (!document.hidden) load()
    document.addEventListener("visibilitychange", visibility)
    document.addEventListener("fullscreenchange", fullscreenChanged)
    return () => {
      clear()
      document.removeEventListener("visibilitychange", visibility)
      document.removeEventListener("fullscreenchange", fullscreenChanged)
    }
  }, [runId])

  if (image === "loading")
    return (
      <p className="collab-image-empty" role="status">
        正在读取授权影像…
      </p>
    )
  if (image === "unavailable")
    return (
      <p className="collab-image-empty">
        影像暂不可读取，请核对访问权限或稍后重试。
      </p>
    )
  return (
    <>
      <button
        type="button"
        className="roundtable-image"
        onClick={() => {
          setScale(minimum)
          setViewerError(false)
          setOpen(true)
        }}
        aria-label="打开放大眼底影像"
      >
        <img src={image.url} alt="本次提交的眼底影像" />
        <span>
          <Maximize size={17} aria-hidden="true" />
        </span>
      </button>
      {open && (
        <Dialog
          open
          title="眼底影像查看器"
          onClose={() => setOpen(false)}
          className="roundtable-dialog roundtable-image-dialog"
          backdropClassName="roundtable-backdrop"
        >
          <div ref={fullscreen} className="roundtable-image-viewer">
            <header className="roundtable-dialog__head">
              <h2>眼底影像</h2>
              <button
                className="collab-button roundtable-icon-button"
                type="button"
                aria-label="关闭影像查看器"
                onClick={() => setOpen(false)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <div
              className="roundtable-image-viewer__canvas"
              data-fit={scale === minimum}
              tabIndex={0}
              aria-label="可滚动的放大影像"
            >
              <img
                src={image.url}
                alt="放大查看本次提交的眼底影像"
                style={{ width: `${scale * 100}%` }}
              />
            </div>
            <div className="roundtable-image-viewer__actions">
              <button
                type="button"
                className="collab-button roundtable-icon-button"
                aria-label="缩小影像"
                disabled={scale <= minimum}
                onClick={() => setScale(Math.max(minimum, scale - 0.5))}
              >
                <Minus size={18} aria-hidden="true" />
              </button>
              <output className="num" aria-label="影像缩放">
                {Math.round(scale * 100)}%
              </output>
              <button
                type="button"
                className="collab-button roundtable-icon-button"
                aria-label="放大影像"
                disabled={scale >= maximum}
                onClick={() => setScale(Math.min(maximum, scale + 0.5))}
              >
                <Plus size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="collab-button roundtable-icon-button"
                aria-label="重置缩放"
                onClick={() => setScale(minimum)}
              >
                <RotateCcw size={17} aria-hidden="true" />
              </button>
              {typeof document !== "undefined" &&
                document.fullscreenEnabled && (
                  <button
                    type="button"
                    className="collab-button roundtable-icon-button"
                    aria-label={full ? "退出全屏" : "全屏影像"}
                    onClick={() => {
                      const action = full
                        ? document.exitFullscreen()
                        : fullscreen.current?.requestFullscreen()
                      void action?.catch(() => setViewerError(true))
                    }}
                  >
                    <Maximize size={17} aria-hidden="true" />
                  </button>
                )}
            </div>
            {viewerError && <p role="status">当前浏览器暂无法切换全屏。</p>}
          </div>
        </Dialog>
      )}
    </>
  )
}
