import "@/styles/records.css"

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react"
import { ArrowRight, ArrowUpRight } from "lucide-react"
import { useNavigate, Link } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { describeError, listMyDiagnoses, updateProfile, uploadAvatar } from "@/lib/api"
import { highRiskCell, loadServerStats, resolveScopedStats, statsLabels } from "@/lib/records"
import {
  confidencePercent,
  formatTimestamp,
  severityLabel,
  severityRisk,
} from "@/lib/domain"
import { queryKeys } from "@/lib/queryKeys"
import { faultFromError, infoFault, validationFault } from "@/lib/faults"
import {
  ACCEPTED_PICTURE_TYPES,
  UPLOAD_LIMIT_HINT,
  exceedsUploadLimit,
  uploadLimitError,
} from "@/lib/uploadLimits"
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

  // 服务端聚合与样本列表并行发出；不可用时在渲染期回退到本页样本。
  // 统计是账号级的，查询键不带页码：与记录页共享同一份缓存，翻页不会重复请求。
  const statsQuery = useQuery({
    queryKey: queryKeys.records.stats(scope),
    queryFn: ({ signal }) => loadServerStats(signal),
    enabled: authed && !!user,
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

    if (!ACCEPTED_PICTURE_TYPES.includes(file.type as (typeof ACCEPTED_PICTURE_TYPES)[number])) {
      push(validationFault("头像只支持 JPG、PNG 或 WebP"))
      return
    }
    // 服务端头像上传走 FileManager.validPicture，硬上限与判读影像同一处；
    // 前端原先写 10 MB，选了 3 MB 的图只会被服务端拒掉。
    if (exceedsUploadLimit(file.size)) {
      push(validationFault(uploadLimitError("图片")))
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

  // 统计读不出来不拦着资料编辑：服务端聚合不可用时退回本页汇总，口径标 page。
  // 列表读失败才叫 sampleFault——它同时决定「最近判读」那块的错误态。
  const sampleFault = sampleQuery.error ? describeError(sampleQuery.error) : null
  const statsLoading = sampleQuery.isPending || statsQuery.isPending
  const serverStats = statsQuery.data ?? null
  // 聚合与列表并行发出，合成放在渲染期：聚合拿不到就取本页样本。
  // 直接把 0 当读数是不行的——「没判读过」和「读不出来」是两回事。
  const scoped = resolveScopedStats(serverStats, sample?.records ?? [], sample?.total ?? 0)
  const stats = scoped.stats
  const labels = statsLabels(scoped.scope)
  // 两个来源都没有读数时显示「—」，不显示 0。
  const hasStats = serverStats !== null || sample !== undefined
  // 最近判读：与判读记录页同一份列表数据（第一页），按时间倒序取前三条。
  const recent = useMemo(() => {
    const list = [...(sample?.records ?? [])]
    list.sort((a, b) => (b.createTime ?? "").localeCompare(a.createTime ?? ""))
    return list.slice(0, 3)
  }, [sample])
  // 高风险读数与记录页同一口径：没有分级数据时显示「未评估」，不显示 0。
  const risk = highRiskCell(stats, scoped.scope, `近 ${PROFILE_SAMPLE} 条`)
  // 角色文案是一次字典查找，不需要 memo；手写依赖反而与编译器推断不一致。
  const roleLabel = user?.userRole ? (ROLE_LABEL[user.userRole] ?? user.userRole) : "—"

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

        {/* 身份先于数字：头像、称呼与账号属性是第一视觉；
            判读统计降成一行摘要，口径仍随数据来源标注（不是全量就写清楚）。 */}
        <section className="profile__identity" aria-label="账号身份">
          <span className="profile__avatar profile__avatar--lg" aria-hidden="true">
            {user.userAvatar ? (
              <img src={user.userAvatar} alt="" />
            ) : (
              <span className="profile__avatar-fallback">{name.slice(0, 1)}</span>
            )}
          </span>

          <div className="profile__identity-main">
            <h2 className="profile__name">{name}</h2>
            <p className="profile__identity-meta">
              {roleLabel}
              {user.createTime ? ` · 注册于 ${user.createTime.slice(0, 10)}` : ""}
            </p>
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
                支持 JPG / PNG / WebP，{UPLOAD_LIMIT_HINT}（服务端单张上限）。上传后立即生效，全站可见。
              </p>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(event) => void onAvatarChange(event)}
              />
            </div>
          </div>

          {/* 统计摘要靠右：身份在左、数字在右，宽屏上不吊着一大片空白。 */}
          <div className="profile__identity-stats">
            <p className="profile__identity-stats-line num">
              {statsLoading
                ? "判读统计读取中…"
                : hasStats
                  ? `${labels.total} ${stats.total} · ${risk.label} ${risk.value}`
                  : "判读统计暂不可用"}
            </p>
            {!statsLoading && risk.note ? (
              <p className="profile__identity-note">{risk.note}</p>
            ) : null}
            {!statsLoading && serverStats === null && hasStats ? (
              <p className="profile__identity-note">
                服务端聚合暂不可用，这里的数字取自最近 {PROFILE_SAMPLE} 条记录，不是全量。
              </p>
            ) : null}
          </div>
        </section>

        <div className="profile__grid">
          <div className="profile__side">
          {/* ── 最近判读（真实数据，同一页记录的前几条） ─── */}
          <section className="profile__card profile__card--recent">
            <div className="profile__card-head">
              <span className="profile__card-title">最近判读 · RECENT</span>
            </div>

            {/* 错误 > 空 > 加载（DESIGN.md §3.11）：列表读失败就说读失败，
                不能在故障之上盖一层「还没有判读记录」——那会把读不到
                说成名下没有，误导的正是「有没有判过」这种判断。 */}
            {sampleFault && recent.length === 0 ? (
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
                    <Link className="profile__recent-link" to={`/records/${item.id}`}>
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
                    </Link>
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
