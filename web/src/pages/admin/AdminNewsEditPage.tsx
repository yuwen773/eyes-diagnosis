import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
} from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Check, ImagePlus, Save, Trash2, Upload } from "lucide-react"
import MDEditor from "@uiw/react-md-editor"

import "@uiw/react-md-editor/markdown-editor.css"
import "@uiw/react-markdown-preview/markdown.css"

import { AdminPageHead } from "@/components/admin/AdminPageHead"
import { FaultNote } from "@/components/fault"
import { useTheme } from "@/components/theme-provider"
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
import { newsPlainText } from "@/lib/news"
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
const LEAVE_CONFIRM = "有未保存的修改，确定离开编辑页吗？未保存的内容会丢失。"
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

/** 正文里参与摘要的可见字数：与后端 `buildSummary` 同一口径——
 *  先按落库管线渲染成 HTML，再剥标签、反转义、压缩空白。Markdown 记号
 *  不进正文，代码块与链接文字则和后端一样计入（后端只剥 HTML）。 */
function visibleLength(content: string): number {
  return newsPlainText(renderNewsHtml(content)).replace(/\s+/g, " ").trim().length
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
  // 草稿是否有未保存修改：页头的「返回列表」与编辑器共用同一份状态。
  const [dirty, setDirty] = useState(false)

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
        dirty={dirty}
        setDirty={setDirty}
      />
    )
  }

  return (
    <div className="admin-newsedit">
      <AdminPageHead
        code="03"
        title={isNew ? "新建资讯" : "编辑资讯"}
        eyebrow="ADMIN · NEWS EDIT"
        description="标题、正文与发布设置在同一屏内完成；预览与公开页共用同一条净化管线。"
        actions={<BackButton dirty={dirty} />}
      />
      {body}
    </div>
  )
}

function BackButton({ dirty }: { dirty: boolean }): ReactElement {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className="admin-btn admin-btn--ghost admin-newsedit__back"
      onClick={() => {
        if (dirty && !window.confirm(LEAVE_CONFIRM)) return
        navigate("/admin/news")
      }}
    >
      <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
      返回列表
    </button>
  )
}

function NewsEditor(props: {
  newsId: string | null
  initial: AdminNews | null
  success: string | null
  setSuccess: (message: string | null) => void
  dirty: boolean
  setDirty: (dirty: boolean) => void
}): ReactElement {
  const { newsId, initial, success, setSuccess, dirty, setDirty } = props
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { resolvedTheme } = useTheme()
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
  /** 表单修订号：请求返回时只清掉「提交时的那个版本」的 dirty，不吞掉在途编辑。 */
  const revisionRef = useRef(0)

  // 未保存离开提醒：beforeunload 管「关标签 / 刷新」，捕获阶段的站点内链接
  // 管「点侧栏去别的页」。BrowserRouter 没有 useBlocker，所以只拦真实 <a href>，
  // 不伪造路由守卫，也不改写保存状态。
  // 新标签意图（修饰键点击）与指向当前路由的链接不拦——前者用户明确要开新窗口，
  // 后者的「离开」根本不成立，拦下来是假警报。
  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    const guardLinks = (event: MouseEvent) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
        return
      }
      if (!(event.target instanceof Element)) return
      const anchor = event.target.closest("a[href]")
      if (!anchor) return
      const href = anchor.getAttribute("href") ?? ""
      if (!href.startsWith("/")) return
      if (href === window.location.pathname + window.location.search) return
      if (window.confirm(LEAVE_CONFIRM)) return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener("beforeunload", handler)
    document.addEventListener("click", guardLinks, true)
    return () => {
      window.removeEventListener("beforeunload", handler)
      document.removeEventListener("click", guardLinks, true)
    }
  }, [dirty])

  function patch(next: Partial<Form>) {
    revisionRef.current += 1
    setDirty(true)
    // 新修改出现后，上一次「已保存」不再是当前状态，立刻收掉成功提示。
    setSuccess(null)
    // 只有正文变了才走渲染管线重写；封面的插入也算正文变更。
    if (Object.prototype.hasOwnProperty.call(next, "content")) setContentDirty(true)
    setForm((prev) => ({ ...prev, ...next }))
  }

  // 只在预览态解析：编辑态每敲一个字都重渲染，没必要把全文再过一遍
  // markdown（与 AssistantMessage 的流式策略同源）。
  // 预览与落库、公开页显示走同一条管线——所见即所存。
  const previewHtml = tab === "preview" ? renderNewsHtml(form.content) : ""
  const contentLength = useMemo(() => visibleLength(form.content), [form.content])
  // 侧栏读数位窄：同一状态用短标签，避免「没有未保存的修改」把数字列挤歪。
  const saveStateShort = saving
    ? "保存中…"
    : dirty
      ? "未保存"
      : success
        ? "已保存"
        : isNew
          ? "尚未创建"
          : "已同步"

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
    // 快照：保存期间用户还能继续输入，响应回来时不能把这些新修改也标成已保存。
    const submittedRevision = revisionRef.current
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
      const unchanged = revisionRef.current === submittedRevision
      if (unchanged) setDirty(false)
      if (isNew) {
        // 新建后回填路由：换成带 id 的编辑路由，下一次保存与封面上传都带 id。
        setSuccess(
          unchanged
            ? "已创建，可继续上传封面或修改"
            : "已创建；保存期间的新修改尚未保存",
        )
        navigate(`/admin/news/${savedId}/edit`, { replace: true })
      } else {
        setSuccess(unchanged ? "已保存" : "已保存；保存期间的新修改尚未保存")
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
        // 封面已即时写库：只回填表单，不把 dirty 抹成 false——
        // 用户可能在等待上传时已经改了标题 / 正文，那些修改仍未保存。
        setForm((prev) => ({ ...prev, coverImage: url }))
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

  function insertCoverIntoContent() {
    if (!form.coverImage) return
    patch({ content: `${form.content}\n\n![封面](${form.coverImage})\n` })
    setTab("edit")
  }

  return (
    <form className="admin-newsedit__form" onSubmit={onSubmit}>
      <div className="admin-newsedit__workspace">
        <div className="admin-newsedit__main">
          {/* 工具行：编辑 / 预览 tab + 保存态 + 主保存。 */}
          <div className="admin-newsedit__topbar">
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

            {/* 保存状态只保留右侧栏「保存状态」一处读数：
                tab 行再放一份会让人以为有第三个视图。 */}

            <button
              className="admin-btn admin-btn--primary admin-newsedit__save"
              type="submit"
              disabled={saving}
            >
              {saving ? (
                "保存中…"
              ) : isNew ? (
                <>
                  <Check size={14} strokeWidth={2} aria-hidden="true" />
                  创建
                </>
              ) : (
                <>
                  <Save size={14} strokeWidth={2} aria-hidden="true" />
                  保存
                </>
              )}
            </button>
          </div>

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

          <label className="admin-newsedit__field">
            <span className="admin-newsedit__label">标题 · TITLE</span>
            <input
              className="admin-newsedit__input admin-newsedit__input--title"
              type="text"
              value={form.title}
              onChange={(event) => patch({ title: event.target.value })}
              placeholder="输入文章标题…"
              aria-label="标题"
            />
          </label>

          <div className="admin-newsedit__editor" data-color-mode={resolvedTheme}>
            <div className="admin-newsedit__editor-head">
              <span className="admin-newsedit__label">正文 · MARKDOWN</span>
              <span className="admin-newsedit__editor-count num">
                {contentLength} 字 · 摘要取前 30 字
              </span>
            </div>
            {tab === "edit" ? (
              <MDEditor
                value={form.content}
                onChange={(value) => {
                  patch({ content: value ?? "" })
                }}
                preview="edit"
                visibleDragbar={false}
                height={520}
                extraCommands={[]}
                textareaProps={{
                  placeholder: "用 Markdown 撰写正文…",
                  "aria-label": "正文",
                }}
              />
            ) : (
              <div className="admin-newsedit__preview">
                {/* markdown.ts 以 html:false 渲染，原始 HTML 已转义、危险链接被禁用；
                    与 AssistantMessage 同一条 innerHTML 注入路径。 */}
                <div
                  className="markdown-body"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </div>
            )}
            <p className="admin-newsedit__editor-hint">
              <span>Markdown · 支持标题 / 粗斜体 / 链接 / 列表 / 引用 / 代码块</span>
              <span>Ctrl+Z 撤销 · Ctrl+Shift+Z 重做</span>
            </p>
          </div>
        </div>

        <aside className="admin-newsedit__rail" aria-label="发布设置">
          <section className="admin-newsedit__rail-group">
            <h2 className="admin-newsedit__rail-title">发布设置</h2>
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
                placeholder="状态变更时写入审核留痕"
                aria-label="审核意见或下架原因"
              />
            </label>
          </section>

          <section className="admin-newsedit__cover" aria-label="封面图片">
            <h2 className="admin-newsedit__rail-title">封面 · COVER</h2>
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
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  disabled={isNew || uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={13} strokeWidth={2} aria-hidden="true" />
                  {uploading ? "上传中…" : form.coverImage ? "更换" : "上传封面"}
                </button>
                {form.coverImage ? (
                  <>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      disabled={isNew}
                      onClick={insertCoverIntoContent}
                    >
                      <ImagePlus size={13} strokeWidth={2} aria-hidden="true" />
                      插入正文
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      disabled={isNew}
                      onClick={clearCover}
                    >
                      <Trash2 size={13} strokeWidth={2} aria-hidden="true" />
                      清除
                    </button>
                  </>
                ) : null}
                <span className="admin-newsedit__cover-hint num">JPG / PNG · ≤5MB</span>
              </div>
            </div>
          </section>

          <div className="admin-newsedit__meta-list">
            <div className="admin-newsedit__meta-row">
              <span>正文字符</span>
              <b className="num">{contentLength}</b>
            </div>
            <div className="admin-newsedit__meta-row">
              <span>摘要长度</span>
              <b className="num">
                {contentLength >= 30 ? "30 字" : "不足 30 字"}
              </b>
            </div>
            <div className="admin-newsedit__meta-row">
              <span>保存状态</span>
              <b>{saveStateShort}</b>
            </div>
          </div>

          <p className="admin-newsedit__footer num">{SUMMARY_HINT}</p>
        </aside>
      </div>
    </form>
  )
}

export default AdminNewsEditPage
