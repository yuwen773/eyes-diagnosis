import { useRef } from "react"
import type { FormEvent } from "react"

/**
 * 表单提交流水号：一次用户手势只放行一次提交。
 *
 * pending 状态会在渲染提交之前先打开，所以按钮 disabled 能挡住多数重复点击；
 * 这里再挡一层「Enter + click 同帧到达」与异步渲染空窗，避免真发两次请求。
 * 校验失败不换票，修好字段后由同一次事件流重新申请。
 */
export function useFormSubmit(run: () => void | Promise<void>) {
  const pendingRef = useRef(false)
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pendingRef.current) return
    pendingRef.current = true
    void Promise.resolve()
      .then(run)
      .finally(() => {
        pendingRef.current = false
      })
  }
}
