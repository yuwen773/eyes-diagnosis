import { describe, expect, it } from "vitest"
import {
  ACCEPTED_IMAGE_TYPES,
  ACCEPTED_PICTURE_TYPES,
  UPLOAD_LIMIT_BYTES,
  UPLOAD_LIMIT_HINT,
  UPLOAD_LIMIT_MB,
  exceedsUploadLimit,
  uploadLimitError,
} from "./uploadLimits"

describe("上传体积口径", () => {
  it("与服务端 FileManager 的 2 MB 硬限一致", () => {
    expect(UPLOAD_LIMIT_BYTES).toBe(2 * 1024 * 1024)
    expect(UPLOAD_LIMIT_MB).toBe(2)
    expect(UPLOAD_LIMIT_HINT).toBe("不超过 2 MB")
  })

  it("恰好等于上限不算超限，多 1 字节才算", () => {
    expect(exceedsUploadLimit(UPLOAD_LIMIT_BYTES)).toBe(false)
    expect(exceedsUploadLimit(UPLOAD_LIMIT_BYTES + 1)).toBe(true)
  })

  it("拦截文案带上具体对象与真实上限", () => {
    expect(uploadLimitError("影像")).toBe("影像超过 2 MB（服务端单张上限），请压缩后重试")
    expect(uploadLimitError()).toContain("2 MB")
  })

  it("判读只收 JPG / PNG；头像等通用图片再加 WebP", () => {
    expect(ACCEPTED_IMAGE_TYPES).toEqual(["image/jpeg", "image/png"])
    expect(ACCEPTED_PICTURE_TYPES).toContain("image/webp")
    expect(ACCEPTED_PICTURE_TYPES).not.toContain("image/gif")
  })
})
