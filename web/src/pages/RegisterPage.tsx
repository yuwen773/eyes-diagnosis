import { useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { AuthShell } from "@/components/AuthShell"
import { IrisFormAlert } from "@/components/system/IrisFormAlert"
import { useFormSubmit } from "@/components/system/useFormSubmit"
import { authFormMessage } from "@/lib/authForm"
import { register } from "@/lib/api"
import { safeRedirect } from "@/lib/redirect"
import { faultFromError, validationFault, type Fault } from "@/lib/faults"

export function RegisterPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const redirect = safeRedirect(params.get("redirect"))

  const [account, setAccount] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [fault, setFault] = useState<Fault | null>(null)
  const [field, setField] = useState<"account" | "password" | "confirm" | null>(null)
  const [pending, setPending] = useState(false)

  const submit = useFormSubmit(async () => {
    if (account.trim().length < 4) {
      setFault(validationFault("账号至少 4 位"))
      setField("account")
      requestAnimationFrame(() => document.getElementById("account")?.focus())
      return
    }
    if (password.length < 8) {
      setFault(validationFault("密码至少 8 位"))
      setField("password")
      requestAnimationFrame(() => document.getElementById("password")?.focus())
      return
    }
    if (password !== confirm) {
      setFault(validationFault("两次输入的密码不一致"))
      setField("confirm")
      requestAnimationFrame(() => document.getElementById("confirm")?.focus())
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
  })

  const message = fault ? authFormMessage(fault, "register") : null

  function onFieldChange(
    name: "account" | "password" | "confirm",
    value: string,
    setter: (value: string) => void,
  ) {
    setter(value)
    if (field === name && fault?.kind === "validation") {
      setFault(null)
      setField(null)
    }
  }

  return (
    <AuthShell
      kicker="Create account · 注册"
      title="建立你的判读档案"
      sub="注册后，每次判读都会归档到你的账号下，随时可以回看记录。"
    >
      <form className="form" onSubmit={submit} noValidate>
        {message && !field ? (
          <IrisFormAlert
            severity={message.tone}
            title={message.title}
            detail={message.detail}
          />
        ) : null}

        <div className="field" data-fault={field === "account" ? fault?.severity : undefined}>
          <label className="field__label" htmlFor="account">
            账号 · Account
          </label>
          <input
            id="account"
            className="field__input"
            autoComplete="username"
            value={account}
            onChange={(event) => onFieldChange("account", event.target.value, setAccount)}
            placeholder="至少 4 位，字母或数字"
            aria-invalid={field === "account" || undefined}
            aria-describedby={field === "account" ? "account-error" : undefined}
          />
          {field === "account" && message ? (
            <IrisFormAlert id="account-error" severity={message.tone} title={message.title} field />
          ) : null}
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
            onChange={(event) => onFieldChange("password", event.target.value, setPassword)}
            placeholder="至少 8 位"
            aria-invalid={field === "password" || undefined}
            aria-describedby={field === "password" ? "password-error" : undefined}
          />
          {field === "password" && message ? (
            <IrisFormAlert id="password-error" severity={message.tone} title={message.title} field />
          ) : null}
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
            onChange={(event) => onFieldChange("confirm", event.target.value, setConfirm)}
            placeholder="再输入一次"
            aria-invalid={field === "confirm" || undefined}
            aria-describedby={field === "confirm" ? "confirm-error" : undefined}
          />
          {field === "confirm" && message ? (
            <IrisFormAlert id="confirm-error" severity={message.tone} title={message.title} field />
          ) : null}
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
