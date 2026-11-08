import { useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { AuthShell } from "@/components/AuthShell"
import { ApiError } from "@/lib/api"
import { useSession } from "@/lib/session"

export function LoginPage() {
  const { signIn } = useSession()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const redirect = params.get("redirect") || "/diagnosis"

  const [account, setAccount] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!account.trim() || !password) {
      setError("请填写账号与密码")
      return
    }

    setPending(true)
    setError("")
    try {
      await signIn(account.trim(), password)
      navigate(redirect, { replace: true })
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "登录失败，请稍后重试")
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthShell
      kicker="Sign in · 登录"
      title="进入判读台"
      sub="用已有账号登录。未登录时也可以先看一份示例记录。"
    >
      <form className="form" onSubmit={onSubmit} noValidate>
        {error ? (
          <p className="form__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="field">
          <label className="field__label" htmlFor="account">
            账号 · Account
          </label>
          <input
            id="account"
            className="field__input"
            autoComplete="username"
            value={account}
            onChange={(event) => setAccount(event.target.value)}
            placeholder="useraccount"
            aria-invalid={Boolean(error) || undefined}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="password">
            密码 · Password
          </label>
          <input
            id="password"
            className="field__input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            aria-invalid={Boolean(error) || undefined}
          />
        </div>

        <button className="btn btn--block" type="submit" disabled={pending}>
          {pending ? "正在验证…" : "登录"}
        </button>

        <div className="form__foot">
          <span className="form__meta">
            还没有账号？<Link to={`/register?redirect=${encodeURIComponent(redirect)}`}>注册一个</Link>
          </span>
          <Link className="form__meta" to="/">
            返回首页
          </Link>
        </div>
      </form>
    </AuthShell>
  )
}
