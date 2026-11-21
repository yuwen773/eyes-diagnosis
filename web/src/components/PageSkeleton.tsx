import type { ReactElement } from "react"

import { IrisPageLoading } from "@/components/system/IrisStates"

/**
 * 路由分包时的占位。
 *
 * 保留原导出名与 `role=status` 语义，视觉升级为 Iris 路由加载态：
 * 品牌光学环 + 温和文案 + 与内容同形的骨架条。不造假进度，不设置
 * 最短等待时间；`min-height` 继续兜住 CLS。
 */
export function PageSkeleton(): ReactElement {
  return <IrisPageLoading />
}
