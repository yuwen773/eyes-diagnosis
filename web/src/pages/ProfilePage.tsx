import "@/styles/records.css"

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react"
import { ArrowRight, ArrowUpRight } from "lucide-react"
import { useNavigate, Link } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { describeError, listMyDiagnoses, updateProfile, uploadAvatar } from "@/lib/api"
import { loadMyStats, statsLabels, type ScopedStats } from "@/lib/records"
import {
  confidencePercent,
  formatTimestamp,
  severityLabel,
  severityRisk,
} from "@/lib/domain"
import { queryKeys } from "@/lib/queryKeys"
import { faultFromError, infoFault, validationFault } from "@/lib/faults"
import { useFault } from "@/components/fault"
import { useSession } from "@/lib/session"
import { EmptyFrame } from "@/components/EmptyFrame"
import { RiskTag } from "@/components/RiskTag"
import { SectionHead } from "@/components/SectionHead"
import { DisclaimerBar } from "@/components/DisclaimerBar"
import { ProductHeader } from "@/components/shell/ProductHeader"

const ROLE_LABEL: Record<string, string> = {
  admin: "管理员",
  user: "注册用户",
}

/** 服务端聚合未上线时，本页统计取自最近这一页记录。 */
const PROFILE_SAMPLE = 10

export function ProfilePage() {
  const { user, status, scope, refresh } = useSession()
  const navigate = useNavigate()
  const { push } = useFault()
  /** 只有确认登录了才发个人请求。 */
  const authed = status === "authed"

  const name = user?.userName || user?.userAccount || "账号"

  /* ── 判读统计（服务端全量优先，未上线时取最近一页） ───── */
  const queryClient = useQueryClient()

  // 与判读记录页第 1 页同键：两页共享同一份列表缓存（同一账号 scope 内）。
  const sampleKey = queryKeys.records.mine(scope, { current: 1, pageSize: PROFILE_SAMPLE })
  const sampleQuery = useQuery({
    queryKey: sampleKey,
    queryFn: ({ signal }) =>
      listMyDiagnoses({ current: 1, pageSize: PROFILE_SAMPLE }, signal),
    enabled: authed && !!user,
  })
  const sample = sampleQuery.data

  // 服务端聚合优先；接口未上线或失败时 loadMyStats 自己降级到本页样本。
  const statsQuery = useQuery({
    queryKey: [...sampleKey, "stats"] as const,
    queryFn: ({ signal }) =>
      loadMyStats(sample?.records ?? [], sample?.total ?? 0, signal),
    enabled: authed && !!user && sample !== undefined,
  })

  /* ── 资料编辑 ─────────────────────────────────────────── */
  const [nameDraft, setNameDraft] = useState("")
  const [profileDraft, setProfileDraft] = useState("")
  const [saving, setSaving] = useState(false)

  // 会话加载完成/变化后把草稿对齐到服务端值（只在用户变化时对齐一次）。
  const alignedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!user) return
    const token = String(user.id ?? user.userAccount ?? "")
    if (alignedRef.current === token) return
    alignedRef.current = token
    setNameDraft(user.userName ?? "")
    setProfileDraft(user.userProfile ?? "")
  }, [user])

  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    if (!user) return
    const nextName = nameDraft.trim()
    if (!nextName) {
      push(validationFault("昵称不能是空的——账号总得有个称呼"))
      return
    }

    setSaving(true)
    try {
      await updateProfile({
        userName: nextName,
        userProfile: profileDraft.trim() || undefined,
      })
      await refresh()
      void queryClient.invalidateQueries({ queryKey: ["records"] })
      push(infoFault("资料已更新"))
    } catch (cause) {
      push(faultFromError(cause, { intent: "generic" }))
    } finally {
      setSaving(false)
    }
  }

  /* ── 头像上传 ─────────────────────────────────────────── */
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)

  async function onAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return

    if (!file.type.startsWith("image/")) {
      push(validationFault("头像得是一张图片——当前选中的文件不是"))
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      push(validationFault("图片超过 10MB，换一张小一点的"))
      return
    }

    setUploading(true)
    try {
      await uploadAvatar(file)
      await refresh()
      void queryClient.invalidateQueries({ queryKey: ["records"] })
      push(infoFault("头像已更新"))
    } catch (cause) {
      push(faultFromError(cause, { intent: "upload" }))
    } finally {
      setUploading(false)
    }
  }

  // 统计读不出来不拦着资料编辑：页面降级成「—」并给一条浮条。
  const statsFault = sampleQuery.error ? describeError(sampleQuery.error) : null
  const statsLoading =
    !statsFault && (sampleQuery.isPending || statsQuery.isPending)
  const scoped: ScopedStats | null = statsQuery.data ?? null
  const stats = scoped?.stats ?? { total: 0, highRisk: 0 }
  const labels = statsLabels(scoped?.scope ?? "page")
  // 最近判读：与判读记录页同一份列表数据（第一页），按时间倒序取前三条。
  const recent = useMemo(() => {
    const list = [...(sample?.records ?? [])]
    list.sort((a, b) => (b.createTime ?? "").localeCompare(a.createTime ?? ""))
    return list.slice(0, 3)
  }, [sample])
  const highRiskLabel =
    scoped?.scope === "all" ? labels.highRisk : `近 ${PROFILE_SAMPLE} 条高风险`
  const roleLabel = useMemo(
    () => (user?.userRole ? (ROLE_LABEL[user.userRole] ?? user.userRole) : "—"),
    [user?.userRole],
  )

  if (!user) {
    // 会话还在探测时保持沉默，确认匿名后送登录页（带回跳）。
    return (
      <div className="is-field is-brand-page">
        <ProductHeader scene="clinical" />
        <main className="wrap records">
          <SectionHead code="05" kicker="个人中心" en="ACCOUNT · PROFILE" />
          <div className="records__empty">
            <EmptyFrame label="未登录" />
            <p className="records__empty-title">登录后才能查看个人中心</p>
            <p className="records__empty-body">资料与判读统计都跟着账号走。</p>
            <Link className="btn" to="/login?redirect=%2Fprofile">
              去登录 <ArrowUpRight className="btn__key" size={13} strokeWidth={2} aria-hidden="true" />
            </Link>
          </div>
        </main>
        <DisclaimerBar />
      </div>
    )
  }

  return (
    <div className="is-field is-brand-page">
      <ProductHeader scene="clinical" />

      <main className="wrap records">
        <SectionHead code="05" kicker="个人中心" en="ACCOUNT · PROFILE" />

        <div className="records__intro">
          <h1 className="records__title">个人中心</h1>
          <p className="lead">Account · 账号。资料可改，头像可传，判读统计会从你的判读记录里实时汇总。</p>
        </div>

        {/* 个人域用读数卡，不套四列 KPI 条（DESIGN.md §1.5）：
            四张卡各自带口径，卡与卡之间是发丝线，不是仪表条。 */}
        <div className="profile__stats">
          <div className="profile__stat">
            <span className="readout__label">{labels.total}</span>
            <span className="profile__stat-value num">
              {statsFault || statsLoading ? "—" : stats.total}
            </span>
          </div>
          <div className="profile__stat">
            <span className="readout__label">{highRiskLabel}</span>
            <span className="profile__stat-value num">
              {statsFault || statsLoading ? "—" : stats.highRisk}
            </span>
          </div>
          <div className="profile__stat">
            <span className="readout__label">注册时间 · SINCE</span>
            <span className="profile__stat-value profile__stat-value--date num">
              {user.createTime ? user.createTime.slice(0, 10) : "—"}
            </span>
          </div>
          <div className="profile__stat">
            <span className="readout__label">角色 · ROLE</span>
            <span className="profile__stat-value profile__stat-value--text">{roleLabel}</span>
          </div>
        </div>

        {statsFault ? (
          <div className="records__stats-note">
            判读统计这会儿没读出来（{statsFault.text}），
            <button type="button" className="link" onClick={() => void sampleQuery.refetch()}>
              重试<span className="link__mark">↻</span>
            </button>
          </div>
        ) : null}

        {!statsFault && !statsLoading && scoped?.scope !== "all" ? (
          <p className="records__scope">
            带「近 {PROFILE_SAMPLE} 条」的统计只取自最近一页记录；服务端聚合上线后会自动切到全量。
          </p>
        ) : null}

        <div className="profile__grid">
          <div className="profile__side">
          {/* ── 头像与账号铭牌 ─────────────────────────── */}
          <section className="profile__card">
            <div className="profile__card-head">
              <span className="profile__card-title">头像 · AVATAR</span>
            </div>

            <div className="profile__avatar-row">
              <span className="profile__avatar" aria-hidden="true">
                {user.userAvatar ? (
                  <img src={user.userAvatar} alt="" />
                ) : (
                  <span className="profile__avatar-fallback">{name.slice(0, 1)}</span>
                )}
              </span>

              <div className="profile__avatar-actions">
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? "上传中…" : "更换头像"}
                  <span className="btn__key">↥</span>
                </button>
                <p className="profile__avatar-hint">
                  支持 JPG / PNG / WebP，10MB 以内。上传后立即生效，全站可见。
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => void onAvatarChange(event)}
                />
              </div>
            </div>
          </section>

          {/* ── 最近判读（真实数据，同一页记录的前几条） ─── */}
          <section className="profile__card profile__card--recent">
            <div className="profile__card-head">
              <span className="profile__card-title">最近判读 · RECENT</span>
            </div>

            {/* 错误 > 空 > 加载（DESIGN.md §3.11）：列表读失败就说读失败，
                不能在故障之上盖一层「还没有判读记录」——那会把读不到
                说成名下没有，误导的正是「有没有判过」这种判断。 */}
            {statsFault && recent.length === 0 ? (
              <p className="profile__recent-empty">
                判读记录这会儿没读出来，稍后再来，或去
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    void sampleQuery.refetch()
                    void statsQuery.refetch()
                  }}
                >
                  重试
                </button>
                。
              </p>
            ) : recent.length === 0 ? (
              <p className="profile__recent-empty">
                {sampleQuery.isPending ? "读取中…" : "还没有判读记录。"}
              </p>
            ) : (
              <ul className="profile__recent">
                {recent.map((item) => (
                  <li key={item.id} className="profile__recent-item">
                    <span className="profile__recent-name">
                      {item.aiRejected ? "AI 拒识" : item.result || "未给出判读结果"}
                    </span>
                    <span className="profile__recent-meta">
                      <span className="num">{formatTimestamp(item.createTime)}</span>
                      {!item.aiRejected ? (
                        <>
                          <span className="profile__recent-conf">
                            <span className="readout__label">置信度</span>
                            <span className="num">{confidencePercent(item.confidence)}</span>
                          </span>
                          <RiskTag risk={severityRisk(item.severity ?? undefined)}>
                            {severityLabel(item.severity ?? undefined)}
                          </RiskTag>
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="profile__ledger-link">
              <button type="button" className="link" data-cursor onClick={() => navigate("/records")}>
                查看全部判读记录
                <ArrowRight className="link__mark" size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </section>
          </div>

          {/* ── 资料编辑 ───────────────────────────────── */}
          <section className="profile__card">
            <div className="profile__card-head">
              <span className="profile__card-title">资料 · PROFILE</span>
            </div>

            <form className="profile__form" onSubmit={(event) => void saveProfile(event)}>
              <label className="profile__field">
                <span className="profile__label">昵称</span>
                <input
                  className="profile__input"
                  value={nameDraft}
                  maxLength={30}
                  onChange={(event) => setNameDraft(event.target.value)}
                  placeholder="怎么称呼你"
                />
              </label>

              <label className="profile__field">
                <span className="profile__label">简介</span>
                <textarea
                  className="profile__input profile__input--area"
                  value={profileDraft}
                  maxLength={200}
                  rows={3}
                  onChange={(event) => setProfileDraft(event.target.value)}
                  placeholder="一句话介绍（选填）"
                />
              </label>

              <label className="profile__field">
                <span className="profile__label">账号</span>
                <input className="profile__input" value={user.userAccount ?? ""} disabled readOnly />
              </label>

              <div className="profile__form-foot">
                <button className="btn" type="submit" disabled={saving}>
                  {saving ? "保存中…" : "保存资料"}
                  <span className="btn__key">↵</span>
                </button>
                <span className="profile__form-note">账号与角色不可自行修改。</span>
              </div>
            </form>
          </section>
        </div>
      </main>

      <DisclaimerBar />
    </div>
  )
}
