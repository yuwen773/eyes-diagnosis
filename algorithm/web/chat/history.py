"""Read-only saved diagnoses, scoped to the server's authenticated user."""

import json

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from web.models.diagnosis import Diagnosis
from web.response import _java_date_string


class HistoryQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    recordId: str | None = Field(default=None, pattern=r"^[1-9][0-9]{0,18}$")


HISTORY_TOOL: dict = {"type": "function", "function": {
    "name": "query_diagnosis_history",
    "description": (
        "仅当用户要求查询本人已保存的历史诊断时使用。只读查询，不创建诊断或请求保存确认。"
        "不提供 recordId 时返回最近10条；提供时只查该记录。历史不代表本次病例事实。"
        "身份由服务端绑定，不能指定其他用户。查询结果由系统直接展示，不要编造记录。"),
    "parameters": HistoryQuery.model_json_schema(),
}}

BOUNDARY = "以下为本人已保存的历史诊断，不代表本次症状或本次诊断；未改变本次任务输入。"


def query_history(db: Session, user_id: int, arguments: str) -> str:
    """No user identifier from the model or browser is accepted here."""
    try:
        query = HistoryQuery.model_validate_json(arguments)
        if query.recordId is not None and int(query.recordId) > 2**63 - 1:
            raise ValueError("out of range")
    except (ValidationError, ValueError):
        return "历史诊断查询参数无效，未读取任何记录；不能指定其他用户或执行写入。"
    statement = select(Diagnosis).where(Diagnosis.user_id == user_id, Diagnosis.is_delete == 0)
    if query.recordId is not None:
        statement = statement.where(Diagnosis.id == int(query.recordId))
    try:
        rows = list(db.scalars(statement.order_by(Diagnosis.create_time.desc(), Diagnosis.id.desc()).limit(11)))
        # Serialize while the read transaction is open. Nothing is supplied to the model.
        records = [{"记录ID": str(row.id), "保存时间": _java_date_string(row.create_time) + " UTC",
            "来源": f"已保存诊断记录 t_diagnosis；/api/diagnosis/get/{row.id}",
            "AI记录结果": None if row.ai_rejected else row.result,
            "AI拒绝判断": bool(row.ai_rejected), "拒绝原因": row.abstain_reason,
            "人工复核状态": row.human_review_status or "未记录",
            "人工复核结论": row.human_result if row.human_review_status in {"REVIEWED", "OVERRIDDEN"} else None}
            for row in rows[:10]]
    except SQLAlchemyError:
        return "历史诊断查询失败，请稍后重试；无法据此判断是否存在历史记录，未生成任何诊断。"
    finally:
        # Do not hold the business transaction across streaming/model I/O.
        db.rollback()
    if not records:
        return BOUNDARY + "\n\n未找到本人可访问的已保存历史诊断记录。"
    result = BOUNDARY + "\n\n来源：已保存诊断记录；AI记录结果与人工复核结论分别列示。\n\n"
    result += "\n\n".join("```json\n" + json.dumps(record, ensure_ascii=False, indent=2) + "\n```"
                            for record in records)
    if len(rows) > 10:
        result += "\n\n仅显示最近10条，并非全部历史；可在诊断历史页面查看更早记录，或提供记录ID查询。"
    return result
