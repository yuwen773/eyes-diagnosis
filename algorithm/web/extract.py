"""Document text extractors.

Java routes every format through Apache Tika, which sniffs the bytes and
dispatches to POI/pdfbox internally. That dependency is not available here, so
each supported format gets a narrow reader. All of them are imported **inside**
their function -- ``pypdf`` and ``python-docx`` are absent from the default
interpreter, and importing this module must not require them.

Format support, against ``KnowledgeBaseServiceImpl.ALLOWED_TYPES``:

==========  ==========  ==================================================
type        supported   note
==========  ==========  ==================================================
``pdf``     yes         ``pypdf``
``docx``    yes         ``python-docx``
``txt``     yes         UTF-8 with replacement
``md``      yes         same
``markdown`` yes        same
``doc``     **no**      legacy binary Word; no pure-Python reader.
                      ``pypdf``/``python-docx`` cannot open it, and
                      ``olefile``/``antiword`` would be a new dependency
                      plus an external binary. Raises
                      :class:`web.knowledge.UnsupportedFormat`.
==========  ==========  ==================================================

The ``.doc`` gap is a real narrowing of what the API accepts and is recorded
in ``docs/rewrite-findings.md``. It fails loudly with an actionable message
rather than returning empty text, which would surface as the misleading
"文档内容为空".
"""

import io
import logging

logger = logging.getLogger(__name__)


def extract_pdf(data: bytes) -> str:
    """Text from a PDF via ``pypdf``.

    Page separation is a blank line, matching Tika's paragraph output closely
    enough for the blank-line paragraph splitter downstream. PDFs whose text
    layer is an image (scanned) yield nothing -- Java's Tika does the same
    without OCR, so this is not a regression.
    """
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    pages = []
    for page in reader.pages:
        pages.append(page.extract_text() or "")
    return "\n\n".join(pages)


def extract_docx(data: bytes) -> str:
    """Text from a ``.docx`` via ``python-docx``.

    Paragraphs are joined with a blank line. Tika additionally surfaces tables
    and headers/footers; ``python-docx``'s ``document.paragraphs`` does not.
    Documents that put their content in a table will therefore extract as empty
    here but not under Tika. Recorded as part of the same narrowing as ``.doc``.
    """
    import docx  # python-docx

    document = docx.Document(io.BytesIO(data))
    return "\n\n".join(paragraph.text for paragraph in document.paragraphs)