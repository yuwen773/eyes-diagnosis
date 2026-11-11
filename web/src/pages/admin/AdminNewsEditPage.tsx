import { useRef, useState, type ChangeEvent, type FormEvent, type ReactElement } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "react-router-dom"

import { SectionHead } from "@/components/SectionHead"
import { Toolbar } from "@/components/admin/Toolbar"
import { FaultNote } from "@/components/fault"
import {
  getNews,
  saveNews,
  uploadNewsCover,
  type AdminNews,
} from "@/lib/adminApi"
import { newsContentValid, newsStatusOptionsFor } from "@/lib/adminDomain"
import { describeError, type ErrorDetail } from "@/lib/api"
import { queryKeys } from "@/lib/queryKeys"
import { fault, infoFault, validationFault } from "@/lib/faults"
import { renderNewsHtml } from "@/lib/markdown"
import { htmlToMarkdown } from "@/lib/htmlToMarkdown"

/** 表单是唯一真源：加载完成后把 getNews 的结果一次灌进来。
 *  status 缺省表示「后端没给」（老数据）——保存时省略该键，靠 MyBatis-Plus
 *  NOT_NULL 策略保留库中现值，绝不凭空把已发布新闻写成草稿。
 *  note 是审核意见 / 下架原因；后端 NewsVO 只读暴露 offlineReason，编辑时回填。 */
type Form = { title: string; content: string; coverImage?: string; status?: number; note?: string }

/** 新建默认草稿：后端在 status 缺席时也落草稿，显式给出让下拉能显示当前值。 */
const EMPTY_FORM: Form = { title: "", content: "", status: 0 }

const MAX_COVER_BYTES = 5 * 1024 * 1024
const COVER_ACCEPT = "image/jpeg,image/png"
const SUMMARY_HINT = "正文至少 30 字（后端以正文前 30 字生成摘要）"
/** 新建模式封面引导：uploadCover 需要已存在的 id，首次保存后才能上传。 */
const NEW_COVER_HINT = "新建保存后会生成记录并进入编辑模式，之后可上传封面。"

/** 封面预检：JPG/PNG + ≤5MB。返回 null 表示通过，否则给出页内提示文案（句号收尾）。 */
function coverProblem(file: File): string | null {
  if (file.type !== "image/jpeg" && file.type !== "image/png") {
    return "只能上传 JPG/PNG 格式的图片。"
  }
  if (file.size > MAX_COVER_BYTES) {
    return "图片大小不能超过 5MB。"
  }
  return null
}

/**
 * 新闻编辑（真实端点）。
 *
 * 路由 `/admin/news/:id/edit`，`id === "new"` 为新建。编辑模式挂载时 getNews(id)
 * 灌表单，加载/失败走页内三态；取数沿用 requestSeq 递增序号挡过期响应（StrictMode
 * 双挂载下只有最后一次写 view）。
 *
 * 新建模式直接走 `POST /news/edit`：后端在 id 为空时创建记录并返回新 id
 * （NewsLifecycleService.applyEdit → create）。保存成功后用 replace 跳到
 * `/admin/news/:id/edit`，后续保存与封面上传都带 id；封面在拿到 id 前不可传。
 *
 * 保存有两条硬规矩：一是 newsContentValid 的 30 字守卫（后端按剥标签后的可见
 * 文本判定，短文返回业务错误码）；二是成功留在本页用页内成功条。
 * 状态下拉按后端合法迁移表收窄（newsStatusOptionsFor），并透传 note 作为
 * 审核意见 / 下架原因。清除封面把 coverImage 置 undefined，保存时以空串显式上送
 * （后端 NOT_NULL 策略会丢 null，空串才会真正写入库），保存后生效。
 */
export function AdminNewsEditPage(): ReactElement {
  const { id } = useParams()
  const isNew = id === "new" || !id
  const newsId = isNew ? null : id!
  // 成功提示挂在加载层：新建保存后路由换成 /:id/edit，表单会重挂，提示不能跟着丢。
  const [success, setSuccess] = useState<string | null>(null)

  const newsQuery = useQuery({
    queryKey: queryKeys.admin.newsDetail(newsId ?? ""),
    queryFn: () => getNews(newsId!),
    enabled: !isNew,
  })
  const newsFault = newsQuery.error ? describeError(newsQuery.error) : null

  let body: ReactElement
  if (!isNew && newsQuery.isPending) {
    body = <p className="admin-newsedit__state">正在读取新闻…</p>
  } else if (newsFault) {
    body = (
      <FaultNote
        className="admin-newsedit__fault"
        fault={fault({
          severity: "attention",
          kind: "client",
          title: newsFault.text,
          code: newsFault.code,
        })}
      />
    )
  } else {
    // 表单用 key 重挂：初值只在挂载时读一次（新建保存后换成带 id 的路由），
    // 不需要「数据回来再 setState 回填」的 effect。
    body = (
      <NewsEditor
        key={newsId ?? "new"}
        newsId={newsId}
        initial={newsQuery.data ?? null}
        success={success}
        setSuccess={setSuccess}
      />
    )
  }

  return (
    <div className="admin-newsedit">
      <div className="admin-newsedit__head">
        <SectionHead
          code="03"
          kicker={isNew ? "新闻管理 · 新建" : "新闻管理 · 编辑"}
          en="ADMIN · NEWS EDIT"
        />
        <BackButton />
      </div>
      {body}
    </div>
  )
}

function BackButton(): ReactElement {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className="btn btn--ghost btn--sm admin-newsedit__back"
      onClick={() => navigate("/admin/news")}
    >
      返回列表
    </button>
  )
}

function NewsEditor(props: {
  newsId: string | null
  initial: AdminNews | null
  success: string | null
  setSuccess: (message: string | null) => void
}): ReactElement {
  const { newsId, initial, success, setSuccess } = props
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isNew = newsId === null

  const [form, setForm] = useState<Form>(() => {
    if (!initial) return EMPTY_FORM
    const raw = initial.content ?? ""
    const isHtml = /<[a-z][\s\S]*>/i.test(raw)
    return {
      title: initial.title ?? "",
      content: isHtml ? htmlToMarkdown(raw) : raw,
      coverImage: initial.coverImage ?? undefined,
      status: initial.status ?? undefined,
      note: initial.offlineReason ?? undefined,
    }
  })
  /** 旧文章的原始 HTML；正文未改时原样提交，避免有损往返。 */
  const [legacyHtml] = useState<string | null>(() => {
    const raw = initial?.content ?? ""
    return /<[a-z][\s\S]*>/i.test(raw) ? raw : null
  })
  const [contentDirty, setContentDirty] = useState(false)

  const [tab, setTab] = useState<"edit" | "preview">("edit")
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [formFault, setFormFault] = useState<ReturnType<typeof validationFault> | null>(null)
  const [actionError, setActionError] = useState<ErrorDetail | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function patch(next: Partial<Form>) {
    setForm((prev) => ({ ...prev, ...next }))
  }

  // 只在预览态解析：编辑态每敲一个字都重渲染，没必要把全文再过一遍
  // markdown（与 AssistantMessage 的流式策略同源）。
  // 预览与落库、公开页显示走同一条管线——所见即所存。
  const previewHtml = tab === "preview" ? renderNewsHtml(form.content) : ""

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setFormFault(null)
    setActionError(null)
    setSuccess(null)

    if (!newsContentValid(form.content)) {
      setFormFault(validationFault(SUMMARY_HINT))
      return
    }

    setSaving(true)
    try {
      // 旧版 HTML 且正文没改：原样提交，不做有损往返。
      // 否则用资讯渲染器存 HTML——与预览、公开页同一条管线。
      const content = legacyHtml && !contentDirty ? legacyHtml : renderNewsHtml(form.content)
      // status 只在后端给过时才上送：键缺席 → DTO 的 status 为 null →
      // MyBatis-Plus NOT_NULL 策略跳过 UPDATE SET，库中现值保持。老数据（NewsVO
      // 没有 status）因此不会被一次编辑静默降成草稿；新数据则能真正改发布状态。
      const savedId = await saveNews({
        ...(newsId ? { id: newsId } : {}),
        title: form.title,
        content,
        ...(form.status === undefined ? {} : { status: form.status }),
        ...(form.note?.trim() ? { note: form.note.trim() } : {}),
        // 无条件上送 coverImage：后端 MyBatis-Plus 默认 FieldStrategy.NOT_NULL，
        // null 字段不进 UPDATE SET。清封面时若用 `...(coverImage ? {…} : {})` 丢键，
        // DTO 反序列化成 null → 旧封面被保留，前端却提示「已清除」，静默 no-op。
        // 用空串（非 null）显式写库，才能把「清除」与「不改」区分开。
        coverImage: form.coverImage ?? "",
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.newsAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.statsAll }),
      ])
      if (isNew) {
        // 新建后回填路由：换成带 id 的编辑路由，下一次保存与封面上传都带 id。
        setSuccess("已创建，可继续上传封面或修改")
        navigate(`/admin/news/${savedId}/edit`, { replace: true })
      } else {
        setSuccess("已保存")
      }
    } catch (cause) {
      setActionError(describeError(cause))
    } finally {
      setSaving(false)
    }
  }

  function onPickCover(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = "" // 允许再次选择同名文件
    if (!file || !newsId) return

    const problem = coverProblem(file)
    if (problem) {
      setFormFault(validationFault(problem))
      return
    }

    setFormFault(null)
    setActionError(null)
    setSuccess(null)
    setUploading(true)
    uploadNewsCover(newsId, file).then(
      (url) => {
        setUploading(false)
        patch({ coverImage: url })
        setSuccess("封面已更新")
      },
      (cause) => {
        setUploading(false)
        setActionError(describeError(cause))
      },
    )
  }

  function clearCover() {
    // 置 undefined 表示「清除意图」；保存时 onSubmit 把它序列化成空串上送
    // （coverImage: form.coverImage ?? ""），空串非 null、能过后端 NOT_NULL
    // 策略写进 UPDATE SET，真正把旧封面从库里抹掉。
    patch({ coverImage: undefined })
    setFormFault(null)
    setActionError(null)
    setSuccess("封面已清除，保存后生效")
  }

  return (
        <form className="admin-newsedit__form" onSubmit={onSubmit}>
          {/* 工具行：编辑 / 预览 mono tab + 保存。预览切换只换下半区，
              上半区标题与封面在两种视图下都常驻，避免切到预览就丢了字段入口。 */}
          <Toolbar>
            <div className="admin-newsedit__tools">
              <div className="admin-newsedit__tabs" role="tablist" aria-label="编辑视图">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "edit"}
                  className="admin-newsedit__tab num"
                  onClick={() => setTab("edit")}
                >
                  编辑
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "preview"}
                  className="admin-newsedit__tab num"
                  onClick={() => setTab("preview")}
                >
                  预览
                </button>
              </div>

              <div className="admin-newsedit__actions">
                <button
                  className="btn btn--sm"
                  type="submit"
                  disabled={saving}
                >
                  {saving ? "保存中…" : isNew ? "创建" : "保存"}
                </button>
              </div>
            </div>
          </Toolbar>

          {/* 新建模式：先落库拿 id，才能上传封面。 */}
          {isNew ? (
            <p className="admin-newsedit__guide num">{NEW_COVER_HINT}</p>
          ) : null}

          {legacyHtml ? (
            <p className="admin-newsedit__guide num">
              本文为旧版 HTML，正文已转换为 Markdown 供编辑；一旦修改并保存，将以 Markdown 重写正文。
            </p>
          ) : null}

          {formFault ? (
            <FaultNote className="admin-newsedit__fault" fault={formFault} variant="field" />
          ) : null}
          {actionError ? (
            <FaultNote
              className="admin-newsedit__fault"
              fault={fault({
                severity: "attention",
                kind: "client",
                title: actionError.text,
                code: actionError.code,
              })}
            />
          ) : null}
          {success ? (
            <FaultNote
              className="admin-newsedit__fault"
              fault={infoFault(success)}
              variant="field"
            />
          ) : null}

          <div className="admin-newsedit__fields">
            <label className="admin-newsedit__field">
              <span className="admin-newsedit__label">标题 · TITLE</span>
              <input
                className="admin-newsedit__input"
                type="text"
                value={form.title}
                onChange={(event) => patch({ title: event.target.value })}
                placeholder="输入文章标题…"
                aria-label="标题"
              />
            </label>

            <label className="admin-newsedit__field">
              <span className="admin-newsedit__label">发布状态 · STATUS</span>
              <select
                className="admin-newsedit__select"
                value={form.status ?? ""}
                onChange={(event) =>
                  patch({
                    status:
                      event.target.value === ""
                        ? undefined
                        : Number(event.target.value),
                  })
                }
                aria-label="发布状态"
              >
                {/* 后端没给状态时（老数据）留一条只读占位，保存仍省略该键。 */}
                {form.status === undefined ? (
                  <option value="">未知（保存时保持原值）</option>
                ) : null}
                {newsStatusOptionsFor(form.status).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-newsedit__field">
              <span className="admin-newsedit__label">审核意见 / 下架原因 · NOTE</span>
              <input
                className="admin-newsedit__input"
                type="text"
                value={form.note ?? ""}
                maxLength={200}
                onChange={(event) => patch({ note: event.target.value })}
                placeholder="状态变更时写入审核留痕；下架时作为下架原因"
                aria-label="审核意见或下架原因"
              />
            </label>

            <section className="admin-newsedit__cover" aria-label="封面图片">
              <span className="admin-newsedit__label">封面 · COVER</span>
              <div className="admin-newsedit__cover-row">
                {form.coverImage ? (
                  <img
                    className="admin-newsedit__cover-thumb"
                    src={form.coverImage}
                    alt="新闻封面"
                  />
                ) : (
                  <span className="admin-newsedit__cover-empty num" aria-hidden="true">
                    NO COVER
                  </span>
                )}
                <div className="admin-newsedit__cover-actions">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={COVER_ACCEPT}
                    className="admin-newsedit__file-input"
                    onChange={onPickCover}
                    aria-label="选择封面图片"
                  />
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={isNew || uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? "上传中…" : form.coverImage ? "更换封面" : "上传封面"}
                  </button>
                  {form.coverImage ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={isNew}
                      onClick={clearCover}
                    >
                      清除封面
                    </button>
                  ) : null}
                  <span className="admin-newsedit__cover-hint num">
                    JPG / PNG · ≤5MB
                  </span>
                </div>
              </div>
            </section>

            <div className="admin-newsedit__editor">
              {tab === "edit" ? (
                <label className="admin-newsedit__field admin-newsedit__field--body">
                  <span className="admin-newsedit__label">正文 · MARKDOWN</span>
                  <textarea
                    className="admin-newsedit__textarea"
                    value={form.content}
                    onChange={(event) => {
                      setContentDirty(true)
                      patch({ content: event.target.value })
                    }}
                    placeholder="用 Markdown 撰写正文…"
                    aria-label="正文"
                  />
                </label>
              ) : (
                <div className="admin-newsedit__preview">
                  <span className="admin-newsedit__label">预览 · PREVIEW</span>
                  {/* markdown.ts 以 html:false 渲染，原始 HTML 已转义、危险链接被禁用；
                      与 AssistantMessage 同一条 innerHTML 注入路径。 */}
                  <div
                    className="markdown-body"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              )}
            </div>
          </div>

          <p className="admin-newsedit__footer num">{SUMMARY_HINT}</p>
        </form>
  )
}

export default AdminNewsEditPage
