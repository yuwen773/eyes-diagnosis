import { useRef, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { AuthShell } from "@/components/AuthShell"
import { IrisFormAlert } from "@/components/system/IrisFormAlert"
import { useFormSubmit } from "@/components/system/useFormSubmit"
import { authFormMessage } from "@/lib/authForm"
import { useSession } from "@/lib/session"
import { safeRedirect } from "@/lib/redirect"
import { faultFromError, validationFault, type Fault } from "@/lib/faults"

export function LoginPage() {
  const { signIn } = useSession()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const redirect = safeRedirect(params.get("redirect"))

  const [account, setAccount] = useState("")
  const [password, setPassword] = useState("")
  const [fault, setFault] = useState<Fault | null>(null)
  const [field, setField] = useState<"account" | "password" | null>(null)
  const [pending, setPending] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  const submit = useFormSubmit(async () => {
    if (!account.trim()) {
      setFault(validationFault("请填写账号"))
      setField("account")
      requestAnimationFrame(() => document.getElementById("account")?.focus())
      return
    }
    if (!password) {
      setFault(validationFault("请填写密码"))
      setField("password")
      requestAnimationFrame(() => document.getElementById("password")?.focus())
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
  })

  function onRetry() {
    setFault(null)
    setField(null)
    formRef.current?.requestSubmit()
  }

  const message = fault ? authFormMessage(fault, "login") : null

  return (
    <AuthShell
      kicker="Sign in · 登录"
      title="进入判读台"
      sub="用已有账号登录。未登录时也可以先看一份示例记录。"
    >
      <form className="form" ref={formRef} onSubmit={submit} noValidate>
        {message && !field ? (
          <IrisFormAlert
            severity={message.tone}
            title={message.title}
            detail={message.detail}
            action={
              message.retryable ? (
                <button className="iris-form-alert__retry" type="button" onClick={onRetry}>
                  再试一次
                </button>
              ) : undefined
            }
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
            onChange={(event) => {
              setAccount(event.target.value)
              if (field === "account" && fault?.kind === "validation") {
                setFault(null)
                setField(null)
              }
            }}
            placeholder="useraccount"
            aria-invalid={field === "account" || undefined}
            aria-describedby={field === "account" ? "account-error" : undefined}
          />
          {field === "account" && message ? (
            <IrisFormAlert
              id="account-error"
              severity={message.tone}
              title={message.title}
              field
            />
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
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              if (field === "password" && fault?.kind === "validation") {
                setFault(null)
                setField(null)
              }
            }}
            placeholder="••••••••"
            aria-invalid={field === "password" || undefined}
            aria-describedby={field === "password" ? "password-error" : undefined}
          />
          {field === "password" && message ? (
            <IrisFormAlert
              id="password-error"
              severity={message.tone}
              title={message.title}
              field
            />
          ) : null}
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
