import { useEffect, useState } from "react"
import { reviewApi } from "@/lib/reviewApi"

export function AuthorizedRunImage({
  runId,
  localUrl,
}: {
  runId: string
  localUrl?: string
}) {
  const [image, setImage] = useState<{ run: string; url: string } | null>(null)
  useEffect(() => {
    if (localUrl) return
    const controller = new AbortController()
    let ownedUrl: string | null = null
    void reviewApi
      .image(runId, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return
        ownedUrl = URL.createObjectURL(blob)
        setImage({ run: runId, url: ownedUrl })
      })
      .catch(() => {
        if (!controller.signal.aborted) setImage(null)
      })
    return () => {
      controller.abort()
      if (ownedUrl) URL.revokeObjectURL(ownedUrl)
    }
  }, [runId, localUrl])
  const url = localUrl ?? (image?.run === runId ? image.url : null)
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label="在新窗口放大本次提交影像"
    >
      <img src={url} alt="本次提交的眼底影像" />
    </a>
  ) : (
    <p className="collab-image-empty">
      影像暂不可读取，请核对访问权限或稍后重试。
    </p>
  )
}
