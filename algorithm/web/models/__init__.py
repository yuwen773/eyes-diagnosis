"""ORM models for the five migrating domains.

Column names are camelCase on purpose -- see the module docstring in
``web/db.py``. Attribute names are snake_case (PEP 8); the mapping back to
camelCase columns is explicit on every ``Column``.

Tables NOT modelled here (Agent subsystem, stays on Java): ``t_agent_session``,
``t_agent_message``, ``t_chat_session``, ``t_chat_history``, ``t_upload_task``.

``t_inference_cache`` is written only by ``DiagnosisServiceImpl`` (not by any
Agent code), so it is modelled with the diagnosis domain in Phase 2.2.
"""

from web.models.diagnosis import Diagnosis
from web.models.inference_cache import InferenceCache
from web.models.knowledge import KnowledgeDocument
from web.models.mcp_server import McpServer
from web.models.news import Attachment, News, Paragraph
from web.models.user import User

__all__ = [
    "User",
    "Diagnosis",
    "InferenceCache",
    "News",
    "Paragraph",
    "Attachment",
    "KnowledgeDocument",
    "McpServer",
]
