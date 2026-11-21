/**
 * 图片上传体积口径的唯一来源。
 *
 * <p>服务端真值：`FileManager.validPicture` 对单张图片硬限 2 MB，判读影像、
 * 头像、新闻封面与附件都走它；Agent 图片附件走 `AgentImageUploadService.MAX_SIZE`，
 * 同样是 2 MB。前端任何「≤ N MB」的说明与校验都必须引用这里——
 * 曾经写过 5 MB / 10 MB 的两处，结果用户在本地选得动、服务端直接拒。
 *
 * <p>2 MB 是**当前服务端实现**的上限，不是产品永久承诺。上限变化时只改这一处，
 * 同时改 `FileManager` 与 `AgentImageUploadService`，两边口径必须一起动。
 */
export const UPLOAD_LIMIT_BYTES = 2 * 1024 * 1024
export const UPLOAD_LIMIT_MB = UPLOAD_LIMIT_BYTES / (1024 * 1024)

/** 面向用户的体积说明，例如「不超过 2 MB」。 */
export const UPLOAD_LIMIT_HINT = `不超过 ${UPLOAD_LIMIT_MB} MB`

/** 眼底影像可接受的 MIME 类型：判读只收 JPG / PNG（保持既有产品口径）。 */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png"] as const

/**
 * 头像 / 封面等通用图片：后端 `FileConstant.ALLOW_FILE_SUFFIX` 是
 * jpg / jpeg / png / webp，前端不能比它更宽（否则服务端直接拒）。
 */
export const ACCEPTED_PICTURE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const

/** 是否超过服务端单张上限。 */
export function exceedsUploadLimit(size: number): boolean {
  return size > UPLOAD_LIMIT_BYTES
}

/** 统一的大小拦截文案；subject 用来区分「影像」「头像」等具体对象。 */
export function uploadLimitError(subject = "图片"): string {
  return `${subject}超过 ${UPLOAD_LIMIT_MB} MB（服务端单张上限），请压缩后重试`
}
