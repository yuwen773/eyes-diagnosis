import { useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { AuthShell } from "@/components/AuthShell"
import { ApiError, register } from "@/lib/api"

export function RegisterPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // 注册完要回到来路，登录页也得知道往哪送——redirect 一路带着
  const redirect = params.get("redirect") || "/diagnosis"

  const [account, setAccount] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()

    if (account.trim().length < 4) {
      setError("账号至少 4 位")
      return
    }
    if (password.length < 8) {
      setError("密码至少 8 位")
      return
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致")
      return
    }

    setPending(true)
    setError("")
    try {
      await register({
        userAccount: account.trim(),
        userPassword: password,
        checkPassword: confirm,
      })
      navigate(`/login?redirect=${encodeURIComponent(redirect)}`, { replace: true })
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "注册失败，请稍后重试")
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthShell
      kicker="Create account · 注册"
      title="建立你的判读档案"
      sub="注册后，每次判读都会归档到你的账号下，随时可以回看记录。"
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
            placeholder="至少 4 位，字母或数字"
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
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="至少 8 位"
            aria-invalid={Boolean(error) || undefined}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="confirm">
            确认密码 · Confirm
          </label>
          <input
            id="confirm"
            className="field__input"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder="再输入一次"
            aria-invalid={Boolean(error) || undefined}
          />
        </div>

        <button className="btn btn--block" type="submit" disabled={pending}>
          {pending ? "正在创建…" : "创建账号"}
        </button>

        <div className="form__foot">
          <span className="form__meta">
            已有账号？<Link to={`/login?redirect=${encodeURIComponent(redirect)}`}>直接登录</Link>
          </span>
          <Link className="form__meta" to="/">
            返回首页
          </Link>
        </div>
      </form>
    </AuthShell>
  )
}
