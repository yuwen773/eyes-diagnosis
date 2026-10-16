# Binary Word fixtures

`simple.doc` and `empty.doc` are genuine OLE Word documents, copied without
conversion from Apache POI tag `REL_5_4_1`, `test-data/document/`:

- https://github.com/apache/poi/blob/REL_5_4_1/test-data/document/simple.doc
- https://github.com/apache/poi/blob/REL_5_4_1/test-data/document/empty.doc

Both have the OLE magic `d0cf11e0a1b11ae1` and a `WordDocument` stream.
The first contains `This is a simple file created with Word 97-SR2.`; the second
has no effective text. Neither is a renamed DOCX.

SHA-256:

| File | Digest |
|---|---|
| simple.doc | 4876e828e62d490fa188c7c4e47013e2e0dfdf02f5903dfd374bc0d2b2049ca1 |
| empty.doc | 5f421a3970c70f12296073478380c0849a54c03fb2f4842392c7d3c5039bf1eb |

Apache License 2.0 and upstream notices are included alongside the files.

Ticket 03 adds unmodified `HeaderFooterUnicode.doc` and `PasswordProtected.doc`
from the same Apache POI tag and directory. Header/footer expected text is
independently documented by upstream
`poi-scratchpad/src/test/java/org/apache/poi/hwpf/usermodel/TestHeaderStories.java`.
`chinese-stories.doc` is synthetic, generated with
`python -m web.tests.make_doc_fixture` using python-docx and the verified local
LibreOffice 26.2.6.3 exporter (`doc:MS Word 97`). It is a real OLE binary Word
file, not a renamed DOCX. Its source text is in the generator: Chinese body,
merged/nested table, short cells and Chinese header/footer. No patient data.
Exact committed fixture digests are recorded in ticket 03 `fixtures.json`.

DOCX samples are generated locally with python-docx in `test_document_upload.py`:
Chinese short cells, a long English cell, nested/merged tables, default/first/
even headers and footers, and an empty document. The browser verifier writes
its table sample into its output directory for manual reuse.
