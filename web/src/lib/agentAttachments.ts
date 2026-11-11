/**
 * 附件（待发送图片）的状态模型。
 *
 * 文件与预览 URL 必须一一绑定在同一个对象里——分成两个平行数组时，
 * 删除一项后两个数组长度短暂不一致，渲染时按下标互相取值会取到 undefined。
 * 这里把 url 随文件一起存，删除按 id 走，天然不错位。
 */

import { newId } from "./id"

export type Attachment = {
  id: string
  name: string
  url: string
  /** 原文件——发送时要用，预览 URL 只用于显示。 */
  file: File
}

/** 追加文件，url 由调用方注入（createObjectURL）。 */
export function addFiles(
  prev: Attachment[],
  files: File[],
  createUrl: (file: File) => string,
): Attachment[] {
  return [
    ...prev,
    ...files.map((file) => ({ id: newId(), name: file.name, url: createUrl(file), file })),
  ]
}

/** 按 id 删除。 */
export function removeById(prev: Attachment[], id: string): Attachment[] {
  return prev.filter((a) => a.id !== id)
}
