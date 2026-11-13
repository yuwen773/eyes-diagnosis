import { useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { AuthShell } from "@/components/AuthShell"
import { FaultNote } from "@/components/fault"
import { useSession } from "@/lib/session"
import { faultFromError, validationFault, type Fault } from "@/lib/faults"

export function LoginPage() {
  const { signIn } = useSession()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const redirect = params.get("redirect") || "/diagnosis"

  const [account, setAccount] = useState("")
  const [password, setPassword] = useState("")
  // 校验没过是「还没填对」，钉在出问题的那个框下面；
  // 服务端拒绝是「这次没成」，摆在表单顶上。两种不要混。
  const [fault, setFault] = useState<Fault | null>(null)
  const [field, setField] = useState<"account" | "password" | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!account.trim()) {
      setFault(validationFault("请填写账号"))
      setField("account")
      return
    }
    if (!password) {
      setFault(validationFault("请填写密码"))
      setField("password")
      return
    }

    setPending(true)
    setFault(null)
    setField(null)
    try {
      await signIn(account.trim(), password)
      navigate(redirect, { replace: true })
    } catch (cause) {
      setFault(faultFromError(cause, { intent: "login" }))
      setField(null)
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
        {fault && !field ? <FaultNote fault={fault} /> : null}

        <div className="field" data-fault={field === "account" ? fault?.severity : undefined}>
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
            aria-invalid={field === "account" || undefined}
          />
          {field === "account" && fault ? <FaultNote fault={fault} variant="field" /> : null}
        </div>

        <div className="field" data-fault={field === "password" ? fault?.severity : undefined}>
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
            aria-invalid={field === "password" || undefined}
          />
          {field === "password" && fault ? <FaultNote fault={fault} variant="field" /> : null}
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
