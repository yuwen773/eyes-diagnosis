import { QueryClient } from "@tanstack/react-query"

import { ApiError } from "./api-error"

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
