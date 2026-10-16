"""Reproduce the synthetic Chinese DOC fixture with the pinned local tool."""

from pathlib import Path
import subprocess
import tempfile

from docx import Document

from web.doc_tool import DEFAULT_HOME, executable


def main():
    output = Path(__file__).parent / "fixtures/documents"
    with tempfile.TemporaryDirectory(prefix="eye-doc-fixture-") as directory:
        work = Path(directory)
        document = Document()
        document.add_paragraph("中文眼底检查正文：这是合成的编码与文档解析验收资料，不用于临床判断。")
        document.add_paragraph("Retinal examination synthetic reference with enough text to exercise chunk splitting. " * 12)
        table = document.add_table(rows=2, cols=2)
        table.cell(0, 0).merge(table.cell(0, 1)).text = "合并单元格"
        table.cell(1, 0).text = "眼底随访"
        table.cell(1, 1).add_table(rows=1, cols=1).cell(0, 0).text = "嵌套复查"
        section = document.sections[0]
        section.header.paragraphs[0].text = "文档页眉"
        section.footer.paragraphs[0].text = "文档页脚"
        document.save(work / "chinese-stories.docx")
        subprocess.run([str(executable(DEFAULT_HOME)),
            f"-env:UserInstallation={(work / 'profile').as_uri()}", "--headless", "--norestore",
            "--convert-to", "doc:MS Word 97", "--outdir", str(output),
            str(work / "chinese-stories.docx")], check=True, timeout=120)
        assert (output / "chinese-stories.doc").read_bytes()[:8] == bytes.fromhex("d0cf11e0a1b11ae1")


if __name__ == "__main__":
    main()
