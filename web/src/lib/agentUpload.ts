import { uploadAgentImage } from "./api"
import {
  ACCEPTED_IMAGE_TYPES,
  UPLOAD_LIMIT_BYTES,
  exceedsUploadLimit,
} from "./uploadLimits"
import {
  acquireAgentImage,
  releaseAgentImage,
  retainAgentImage,
} from "./agentImageOwnership"

const inFlight = new Map<string, Promise<string>>()

/**
 * 单张图片上限沿用服务端真值（`AgentImageUploadService.MAX_SIZE` = 2 MB）。
 * 前端曾写 10 MB，用户能选 3 MB 的图，上传到服务端才被拒——本地就该拦。
 */
export const MAX_IMAGE_SIZE = UPLOAD_LIMIT_BYTES

/** 服务端只收 jpeg / png；扩展名兜底同样只认这两种。 */
const IMAGE_EXT = /\.(png|jpe?g)$/i

function isAcceptedImage(file: File): boolean {
  if (file.type) {
    return ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])
  }
  // 部分浏览器剪贴板不给 MIME 类型，此时按扩展名兜底。
  return IMAGE_EXT.test(file.name)
}

/** 只放行服务端接受的图片类型，且不超过大小上限。 */
export function filterImageFiles(files: File[]): File[] {
  return files.filter((f) => isAcceptedImage(f) && !exceedsUploadLimit(f.size))
}

/**
 * 上传器工厂。名字不叫 `use*`：它不调任何 Hook，在 `useMemo` 回调里调用
 * 会被 lint 当成 Hook 误用（规则本身是对的——只是命名误导）。
 */
export function createAgentUploader() {
  function fileKey(file: File): string {
    return `${file.name}:${file.size}:${file.lastModified}`
  }

  async function uploadFiles(files: File[]): Promise<{ urls: string[] }> {
    const urls: string[] = []
    try {
      for (const file of files) {
        const key = fileKey(file)
        const existing = inFlight.get(key)
        const promise = existing ?? uploadAgentImage(file)
        if (!existing) {
          inFlight.set(key, promise)
        }
        const url = await promise
        // 无论与哪个并发批次共用这次上传，本批次都登记自己的一份持有权：
        // 去重只合并网络请求，不合并所有权。
        urls.push(url)
        acquireAgentImage(url)
      }
      return { urls }
    } catch (error) {
      // 失败即回滚本批次已上传成功的部分。页面在 catch 中直接返回，
      // 没有人会引用这些 URL，留着就是 COS 上的孤儿对象。
      // 走 release 而非直接删除，避免误删与其它批次共用的 URL。
      for (const url of urls) {
        releaseAgentImage(url)
      }
      throw error
    } finally {
      for (const file of files) {
        inFlight.delete(fileKey(file))
      }
    }
  }

  /** 消息已成功送达：交出持有权，对象转归这条消息所有 */
  function commitSuccess(urls: string[]) {
    for (const url of urls) {
      retainAgentImage(url)
    }
  }

  /** 消息明确被拒（未登录 / 无权限）：释放持有权，无人持有时删除对象 */
  function commitFailure(urls: string[]) {
    for (const url of urls) {
      releaseAgentImage(url)
    }
  }

  /**
   * 发送结果未知：按「可能已被引用」处理，**不删**。
   *
   * <p>请求可能已经到了服务端并落库，只是响应没回来。删掉一张被消息引用的
   * 图片不可逆（历史记录里留着一条打不开的图）；多留的对象虽然也要人工清理
   * ——`agent-chat/` 有对账，但 {@code PERSISTED} 状态的任务仍在活跃集合里，
   * 对账不会回收它——两害相权选那个还能查回来的。与后端 C-12 同一取舍。
   */
  function commitUnknown(urls: string[]) {
    for (const url of urls) {
      retainAgentImage(url)
    }
  }

  return { uploadFiles, commitSuccess, commitFailure, commitUnknown }
}
