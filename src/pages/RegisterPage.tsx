import { useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { AuthShell } from "@/components/AuthShell"
import { FaultNote } from "@/components/fault"
import { register } from "@/lib/api"
import { faultFromError, validationFault, type Fault } from "@/lib/faults"

export function RegisterPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // 注册完要回到来路，登录页也得知道往哪送——redirect 一路带着
  const redirect = params.get("redirect") || "/diagnosis"

  const [account, setAccount] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  // 校验没过钉在出问题的那个框下面，服务端拒绝摆在表单顶上。
  const [fault, setFault] = useState<Fault | null>(null)
  const [field, setField] = useState<"account" | "password" | "confirm" | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()

    if (account.trim().length < 4) {
      setFault(validationFault("账号至少 4 位"))
      setField("account")
      return
    }
    if (password.length < 8) {
      setFault(validationFault("密码至少 8 位"))
      setField("password")
      return
    }
    if (password !== confirm) {
      setFault(validationFault("两次输入的密码不一致"))
      setField("confirm")
      return
    }

    setPending(true)
    setFault(null)
    setField(null)
    try {
      await register({
        userAccount: account.trim(),
        userPassword: password,
        checkPassword: confirm,
      })
      navigate(`/login?redirect=${encodeURIComponent(redirect)}`, { replace: true })
    } catch (cause) {
      setFault(faultFromError(cause, { intent: "register" }))
      setField(null)
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
            placeholder="至少 4 位，字母或数字"
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
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="至少 8 位"
            aria-invalid={field === "password" || undefined}
          />
          {field === "password" && fault ? <FaultNote fault={fault} variant="field" /> : null}
        </div>

        <div className="field" data-fault={field === "confirm" ? fault?.severity : undefined}>
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
            aria-invalid={field === "confirm" || undefined}
          />
          {field === "confirm" && fault ? <FaultNote fault={fault} variant="field" /> : null}
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
