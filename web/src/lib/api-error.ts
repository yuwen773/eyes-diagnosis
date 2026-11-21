/**
 * 业务错误类型。
 *
 * <p>单独成文件，避免 `http.ts` 与 `api.ts` 循环引用：`api.ts` 需要
 * `request`/`ApiError`，而 `http.ts` 需要错误类。页面用
 * `cause instanceof ApiError` 判断，全站必须是同一个类。
 */
export class ApiError extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = "ApiError"
    this.code = code
  }
}
