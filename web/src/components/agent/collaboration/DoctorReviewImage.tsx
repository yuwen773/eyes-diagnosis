import { useEffect, useState } from "react"
import { reviewApi } from "@/lib/reviewApi"

export function DoctorReviewImage({ reviewId }: { reviewId: string }) {
  const [image, setImage] = useState<{ review: string; url: string } | null>(
    null
  )
  useEffect(() => {
    const controller = new AbortController()
    let ownedUrl: string | null = null
    void reviewApi
      .reviewImage(reviewId, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return
        ownedUrl = URL.createObjectURL(blob)
        setImage({ review: reviewId, url: ownedUrl })
      })
      .catch(() => {
        if (!controller.signal.aborted) setImage(null)
      })
    return () => {
      controller.abort()
      if (ownedUrl) URL.revokeObjectURL(ownedUrl)
    }
  }, [reviewId])
  return (
    <section aria-label="本任务授权复核影像" className="clinical-review-image">
      {image?.review === reviewId ? (
        <a href={image.url} target="_blank" rel="noreferrer">
          <img src={image.url} alt="供医生复核的本任务影像" />
        </a>
      ) : (
        <p>影像暂不可读取，请核对授权或稍后重新打开材料。</p>
      )}
    </section>
  )
}
