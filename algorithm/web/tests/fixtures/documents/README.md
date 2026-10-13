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
DOCX samples are generated locally with python-docx in `test_document_upload.py`:
Chinese short cells, a long English cell, nested/merged tables, default/first/
even headers and footers, and an empty document. The browser verifier writes
its table sample into its output directory for manual reuse.
