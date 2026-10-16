"""Document text extractors.

PDF and DOCX use lazy Python readers; binary DOC uses local LibreOffice in
``web.doc_parser``. Importing this module requires no parser dependencies.

Format support, against ``KnowledgeBaseServiceImpl.ALLOWED_TYPES``:

==========  ==========  ==================================================
type        supported   note
==========  ==========  ==================================================
``pdf``     yes         ``pypdf``
``docx``    yes         ``python-docx``
``txt``     yes         UTF-8 with replacement
``md``      yes         same
``markdown`` yes        same
``doc``     yes         pinned non-JVM converter; see web.doc_parser
==========  ==========  ==================================================

Issue 07 closes the historical J-16 format gap; see docs/document-formats.md.
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
    """Body in document order, including nested tables and active headers/footers.

    A table is one paragraph block so the legacy 20-character paragraph filter
    cannot discard individual short cells. Merged cells and shared header/footer
    parts are emitted once. Images, field instructions and comments are excluded.
    """
    import docx  # python-docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    def blocks(container):
        texts = []
        for item in container.iter_inner_content():
            if isinstance(item, Paragraph):
                texts.append(item.text)
            elif isinstance(item, Table):
                seen = set()
                rows = []
                for row in item.rows:
                    cells = []
                    for cell in row.cells:
                        if cell._tc not in seen:
                            seen.add(cell._tc)
                            cells.append("\n".join(blocks(cell)))
                    rows.append("\t".join(cells))
                texts.append("\n".join(rows))
        return texts

    document = docx.Document(io.BytesIO(data))
    texts = blocks(document)
    seen_parts = set()
    for section in document.sections:
        stories = [section.header, section.footer]
        if section.different_first_page_header_footer:
            stories.extend([section.first_page_header, section.first_page_footer])
        if document.settings.odd_and_even_pages_header_footer:
            stories.extend([section.even_page_header, section.even_page_footer])
        for story in stories:
            if not story.is_linked_to_previous and story.part.partname not in seen_parts:
                seen_parts.add(story.part.partname)
                texts.extend(blocks(story))
    return "\n\n".join(texts)
