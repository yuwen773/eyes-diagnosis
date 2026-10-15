// @ts-ignore
/* eslint-disable */
import request from '@/request'

/** 删除新闻 **Physical** delete.

``News.java`` carries no ``@TableLogic`` annotation and ``t_news`` has no
``isDelete`` column, so MyBatis Plus issues ``DELETE FROM t_news`` and the
row is gone -- including any ``t_paragraph``/``t_attachment`` rows that
reference it, since those declare no foreign key constraint in
``schema.sql:71-77``. That is the existing behaviour and is reproduced as-is.

Returns ``false`` for a row that is already gone, as Java does. POST /news/delete/${param0} */
export async function deleteNews(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.deleteNewsParams,
  options?: { [key: string]: any }
) {
  const { id: param0, ...queryParams } = params
  return request<API.BaseResponseBoolean>(`/news/delete/${param0}`, {
    method: 'POST',
    params: { ...queryParams },
    ...(options || {}),
  })
}

/** 修改新闻 ``updateNews`` (:146-164).

``saveOrUpdate`` with a non-null id resolves to ``updateById``, which under
MyBatis Plus's default ``NOT_NULL`` field strategy writes **only the fields
the DTO populated**. Absent fields are left alone rather than nulled. This
port builds the UPDATE from the fields actually supplied, which is the
same rule.

``editTime`` is deliberately **not** touched. The DTO has no such field and
the DDL's ``DEFAULT CURRENT_TIMESTAMP`` applies to INSERT only (there is no
``ON UPDATE`` clause), so in Java a news row's edit time reflects the last
cover upload, not the last edit.

Two consequences of the faithful port, both existing Java behaviour:

* Re-saving an article with no actual change reports ``操作失败``.
  ``updateById`` returns the affected-row count, and MySQL counts *changed*
  rows by default, so a no-op UPDATE is 0. The frontend shows "保存失败"
  for an article that was, in fact, saved correctly.
* ``id`` must already exist. A new id means ``UPDATE`` matches nothing and
  the same ``操作失败`` is returned -- this endpoint cannot create an
  article. POST /news/edit */
export async function updateNews(body: API.NewsUpdateDTO, options?: { [key: string]: any }) {
  return request<API.BaseResponseBoolean>('/news/edit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** 获取新闻详情 ``getNewsVO`` (:106-114).

The controller builds the VO *before* the null check, which is safe only
because ``getNewsVO(null)`` returns null (``NewsServiceImpl.java:84-86``).
Checked first here. GET /news/get/${param0} */
export async function getNewsVo(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getNewsVOParams,
  options?: { [key: string]: any }
) {
  const { id: param0, ...queryParams } = params
  return request<API.BaseResponseNewsVO>(`/news/get/${param0}`, {
    method: 'GET',
    params: { ...queryParams },
    ...(options || {}),
  })
}

/** 获取分页新闻列表 ``listNewsVOByPage``. No ``@AuthCheck`` -- the news list is public. POST /news/list/page/vo */
export async function listNewsVoByPage(body: API.NewsQueryDTO, options?: { [key: string]: any }) {
  return request<API.BaseResponsePageNewsVO>('/news/list/page/vo', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** 获取分页新闻列表（缓存版） ``listNewsVOByPageWithCache`` (:76-105).

The key is ``md5(json(dto))`` with **no user scoping** -- unlike the user
and diagnosis caches. That is correct here: the payload is public news, so
there is nothing to leak between users.

``json(dto)`` is not byte-identical to Hutool's, so an entry written by Java
is a miss rather than a misparse. Harmless, and only reachable before
Nginx finishes the cutover. POST /news/list/page/vo/cache */
export async function listNewsVoByPageWithCache(
  body: API.NewsQueryDTO,
  options?: { [key: string]: any }
) {
  return request<API.BaseResponsePageNewsVO>('/news/list/page/vo/cache', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** 上传新闻图片 Inline article images.

Returns a bare URL string, not an object -- the frontend collects the
result into an array of ``src`` values (``NewsEditPage.vue:91-100``).
Nothing is written to ``t_news``; ``t_attachment`` is untouched by this
endpoint despite the table existing. POST /news/uploadAttachment */
export async function uploadAttachment(
  body: API.BodyUploadAttachment,
  options?: { [key: string]: any }
) {
  const formData = new FormData()

  Object.keys(body).forEach((ele) => {
    const item = (body as any)[ele]

    if (item !== undefined && item !== null) {
      if (typeof item === 'object' && !(item instanceof File)) {
        if (item instanceof Array) {
          item.forEach((f) => formData.append(ele, f || ''))
        } else {
          formData.append(ele, JSON.stringify(item))
        }
      } else {
        formData.append(ele, item)
      }
    }
  })

  return request<API.BaseResponseString>('/news/uploadAttachment', {
    method: 'POST',
    data: formData,
    ...(options || {}),
  })
}

/** 上传新闻图片封面 ``NewsServiceImpl.uploadCoverImage`` (:104-139).

This endpoint carries the most surprising behaviour in the domain, and the
frontend depends on all of it:

* **Without an ``id`` it cannot succeed.** It inserts a ``News`` populated
  only with ``title``/``userId``/``coverImg``, but ``content`` and
  ``publishTime`` are ``NOT NULL`` with no default
  (``schema.sql:57,61``). The INSERT always fails and the catch-all reports
  ``50000``/``系统错误``.
* **With an ``id`` it overwrites two unrelated columns.** ``title`` is set
  to ``""`` and ``userId`` to the *uploader's* id before the UPDATE, and
  MyBatis Plus writes empty strings (only nulls are skipped). So uploading a
  cover wipes the article's title and reassigns its author.

  The admin editor is built around this: ``NewsEditPage.vue`` uploads the
  cover first, then POSTs ``/edit`` with the real title, restoring it. A
  user who uploads a cover and then closes the tab leaves the article with
  an empty title and a changed author.

  Both columns are written here for fidelity. Dropping them would be
  invisible to the two-step flow and strictly safer, but it is a behaviour
  change rather than a port -- see ruling 21 for the recommendation.
* Returns the cover URL as a bare string, like ``/uploadAttachment``. POST /news/uploadCover */
export async function uploadCoverImage(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.uploadCoverImageParams,
  body: {},
  options?: { [key: string]: any }
) {
  return request<API.BaseResponseString>('/news/uploadCover', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    params: {
      ...params,
      newsUploadDTO: undefined,
      ...params['newsUploadDTO'],
    },
    data: body,
    ...(options || {}),
  })
}
