"""Release ADR-004 decision vocabulary; never accepts routing from a doctor."""

from sqlalchemy import select

from web.workflow.models import WorkflowEvent

DECISION_REASONS = {"APPROVE_CONTINUE": "QUALITY_APPROVED", "REJECT_RESUBMIT": "QUALITY_REJECTED",
    "CONFIRM_AI_ASSESSMENT": "AI_ASSESSMENT_CONFIRMED", "CORRECT_AI_ASSESSMENT": "AI_ASSESSMENT_CORRECTED",
    "INCONCLUSIVE": "INCONCLUSIVE", "CONFIRM_ABSTENTION": "ABSTENTION_CONFIRMED",
    "PROVIDE_INDEPENDENT_REVIEW": "INDEPENDENT_REVIEW_PROVIDED"}


def allowed_decisions(review_type: str, outcome: str) -> list[str]:
    if outcome == "TECHNICAL_FAILURE":
        return []
    if review_type == "IMAGE_QUALITY_GATE":
        return ["APPROVE_CONTINUE", "REJECT_RESUBMIT"]
    if review_type == "FINAL_CLINICAL_REVIEW":
        if outcome == "VALID_PREDICTION":
            return ["CONFIRM_AI_ASSESSMENT", "CORRECT_AI_ASSESSMENT", "INCONCLUSIVE"]
        if outcome == "SAFETY_ABSTENTION":
            return ["CONFIRM_ABSTENTION", "PROVIDE_INDEPENDENT_REVIEW", "INCONCLUSIVE"]
    return []


def review_audit(db, workflow_id: str) -> list[dict]:
    events = db.scalars(select(WorkflowEvent).where(WorkflowEvent.workflow_id == workflow_id,
        WorkflowEvent.event_type.in_(["FINAL_REVIEW_CLAIMED", "FINAL_REVIEW_SUBMITTED",
                                     "EXPLANATION_PUBLISHED", "EXPLANATION_WITHHELD"]))
        .order_by(WorkflowEvent.sequence))
    return [{"eventId": row.event_id, "eventType": row.event_type, "actorType": row.actor_type,
             "workflowVersion": str(row.version), "reasonCode": row.reason,
             "occurredAt": row.occurred_at.isoformat()} for row in events]
