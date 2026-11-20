import { QueryClient } from "@tanstack/react-query"

import { ApiError } from "./api-error"
import { PRIVATE_QUERY_ROOTS } from "./queryKeys"

/**
 * 全站唯一的 QueryClient。
 *
 * <p>重试只对「可能自己好起来」的失败做一次：网络断（-1）与 5xx。业务码错误
 * （未登录、无权限、数据不存在）重试也不会变好，重试只会把错误提示推迟。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.code !== -1 && error.code < 500) return false
        return failureCount < 1
      },
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

/**
 * 身份切换（登录 / 登出 / 换号 / 会话失效）时作废个人域缓存。
 *
 * <p>先取消在途请求再删缓存：取消会让实现了 AbortSignal 的请求真正停下；
 * 即使某个请求没接 signal 晚归，个人域的键里也带着账号 scope（见 queryKeys），
 * 它只会落回旧账号的键，不会被新账号读到。
 */
export function resetPrivateQueries(client: QueryClient) {
  for (const root of PRIVATE_QUERY_ROOTS) {
    void client.cancelQueries({ queryKey: [root] })
    client.removeQueries({ queryKey: [root] })
  }
}
