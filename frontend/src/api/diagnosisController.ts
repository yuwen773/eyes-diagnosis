// @ts-ignore
/* eslint-disable */
import request from '@/request'

/** 删除诊断记录 Logical delete -- ``removeById`` on a ``@TableLogic`` field issues
``UPDATE t_diagnosis SET isDelete=1``, keeping the row for referential
integrity while hiding it from every query. Returns ``false`` for a row
that is absent or already deleted, as Java does. POST /diagnosis/delete/${param0} */
export async function deleteDiagnosis(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.deleteDiagnosisParams,
  options?: { [key: string]: any }
) {
  const { id: param0, ...queryParams } = params
  return request<API.BaseResponseBoolean>(`/diagnosis/delete/${param0}`, {
    method: 'POST',
    params: { ...queryParams },
    ...(options || {}),
  })
}

/** 进行 AI 诊断 ``DiagnosisServiceImpl.doDiagnosis`` (:169-252), with the gRPC hop
replaced by :meth:`web.inference.InferenceEngine.diagnose`.

Failure mode differs from Java's and that is the point: the gRPC servicer
returned an **empty** ``DiagnosisResponse`` on any exception (:161-166),
which Java then stored as a diagnosis with an empty label and
``rejected=false`` -- a fabricated result shown to a patient. The engine
raises instead, so the failure reaches the caller as
``50000``/``系统错误`` with no row written. POST /diagnosis/diagnosis */
export async function doDiagnosis(file: File, options?: { [key: string]: any }) {
  const formData = new FormData()
  formData.append('file', file)
  return request<API.BaseResponseDiagnosisResultVO>('/diagnosis/diagnosis', {
    method: 'POST',
    data: formData,
    ...(options || {}),
  })
}

/** 获取诊断结果 ``getOwnedDiagnosis`` (:282-290) + ``DiagnosisResultVO.objToVo``.

Ownership: a non-admin gets ``NO_AUTH_ERROR`` for someone else's row. Note
that ``NOT_FOUND_ERROR`` takes precedence over the ownership check, so the
existence of a row is disclosed before authorisation -- Java's order, kept
because the two codes drive different frontend flows. GET /diagnosis/get/${param0} */
export async function getDiagnosisResultVo(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getDiagnosisResultVOParams,
  options?: { [key: string]: any }
) {
  const { id: param0, ...queryParams } = params
  return request<API.BaseResponseDiagnosisResultVO>(`/diagnosis/get/${param0}`, {
    method: 'GET',
    params: { ...queryParams },
    ...(options || {}),
  })
}

/** 获取我的诊断列表 ``listMyDiagnosisVOByPage`` (:113-131) -- identical to ``/list/page/vo``.

The Java source looks like it calls a *static* setter
(``DiagnosisQueryDTO.setUserId(...)`` with the class name), which would not
compile. It does, because the parameter is declared
``DiagnosisQueryDTO DiagnosisQueryDTO`` -- the variable name shadows the
type name (JLS 6.5.2), so it is an ordinary instance call and this endpoint
is scoped to the caller exactly like the other two. POST /diagnosis/list/page/my */
export async function listMyDiagnosisVoByPage(
  body: API.DiagnosisQueryDTO,
  options?: { [key: string]: any }
) {
  return request<API.BaseResponsePageDiagnosisManageVO>('/diagnosis/list/page/my', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** 获取分页诊断列表 ``listDiagnosisVOByPage``.

The three list endpoints differ only in caching. ``userId`` is overwritten
with the session user, so a client posting another user's id gets their own
rows back rather than someone else's. POST /diagnosis/list/page/vo */
export async function listDiagnosisVoByPage(
  body: API.DiagnosisQueryDTO,
  options?: { [key: string]: any }
) {
  return request<API.BaseResponsePageDiagnosisManageVO>('/diagnosis/list/page/vo', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** 获取分页诊断列表（缓存版本） ``listDiagnosisVOByPageWithCache`` (:68-110).

The key is ``md5(userId:userRole:json(dto))``, so a shared cache can never
serve one user's medical records to another. The ``json(dto)`` term is not
byte-identical to Hutool's, so a cache entry written by Java is simply a
miss here -- harmless, and only possible before Nginx finishes the cutover. POST /diagnosis/list/page/vo/cache */
export async function listDiagnosisVoByPageWithCache(
  body: API.DiagnosisQueryDTO,
  options?: { [key: string]: any }
) {
  return request<API.BaseResponsePageDiagnosisManageVO>('/diagnosis/list/page/vo/cache', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** 人工复诊 ``DiagnosisServiceImpl.recordHumanReview`` (:255-279).

Only ``human*`` columns are writable. The AI conclusion is deliberately not
in :class:`DiagnosisResultDTO`, so no payload -- however crafted -- can
overwrite ``result``/``probability``/``details``/``aiRejected`` through this
route. That is a schema-level guarantee, not a field-by-field filter.

Validation order is copied because each branch has its own message:
not-admin -> ``仅管理员可写入人工复核字段``, blank ``humanResult`` ->
``必须填写人工结论``. POST /diagnosis/update */
export async function updateDiagnosisResult(
  body: API.DiagnosisResultDTO,
  options?: { [key: string]: any }
) {
  return request<API.BaseResponseBoolean>('/diagnosis/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** 诊断图片上传 ``DiagnosisServiceImpl.uploadDiagnosisPicture`` (:90-113).

The ``id`` form field is accepted and **ignored** -- Java's
``saveOrUpdate`` inserts because the freshly built entity has no id, so the
DTO's id never reaches the database even though the frontend sends it.

``username`` is ``None`` here even though the row has an owner: Java calls
``DiagnosisManageVO.objToVo(diagnosis)`` directly (:112), not
``getDiagnosisManageVO``, so this one endpoint skips the ``t_user`` lookup
that the list endpoints perform. POST /diagnosis/upload */
export async function uploadPicture(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.uploadPictureParams,
  body: {},
  file?: File,
  options?: { [key: string]: any }
) {
  const formData = new FormData()

  if (file) {
    formData.append('file', file)
  }

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

  return request<API.BaseResponseDiagnosisManageVO>('/diagnosis/upload', {
    method: 'POST',
    params: {
      ...params,
    },
    data: formData,
    ...(options || {}),
  })
}
