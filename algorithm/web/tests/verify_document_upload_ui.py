"""Run against document_upload_ui_server and the original Vite frontend."""

import argparse
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from web.tests.test_document_upload import FIXTURES, table_document
from web.tests.session_fixtures import SESSION_COOKIE_NAME


def screenshot(page, path):
    page.locator(".ant-message").evaluate("""async element => {
        await Promise.all(element.getAnimations({subtree: true})
            .map(animation => animation.finished.catch(() => {})))
    }""")
    page.screenshot(path=str(path), full_page=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    table = args.output_dir / "retinal-table.docx"
    table.write_bytes(table_document())
    broken = args.output_dir / "broken.docx"
    broken.write_bytes(b"broken ZIP")
    results = {}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            page.context.add_cookies([{"name": SESSION_COOKIE_NAME, "value": "alice",
                                      "url": "http://127.0.0.1:15180"}])
            page.goto("http://127.0.0.1:15181/")
            page.wait_for_load_state("networkidle")
            page.get_by_text("格式验证账号", exact=False).first.wait_for(state="attached")
            page.goto("http://127.0.0.1:15181/admin/knowledge")
            page.wait_for_load_state("networkidle")
            page.screenshot(path=str(args.output_dir / "initial.png"), full_page=True)
            page.get_by_text("点击或拖拽文件到此区域上传", exact=True).wait_for()
            page.locator("input[type=file]").set_input_files([str(FIXTURES / "simple.doc"), str(table)])
            with page.expect_response(lambda response: response.url.endswith("/api/knowledge/upload")) as upload:
                page.get_by_role("button", name="开始上传").click()
            result = upload.value.json()
            assert result["code"] == 0 and len(result["data"]) == 2, result
            expect(page.get_by_role("cell", name="已完成", exact=True)).to_have_count(2)
            retrieval = page.request.get("http://127.0.0.1:15180/_test/search").json()
            text = "\n".join(retrieval["documents"][0])
            assert "Word 97-SR2" in text and "眼底随访" in text and "每年复查" in text
            results["ui_upload_to_controlled_retrieval"] = "PASS"
            screenshot(page, args.output_dir / "upload-completed.png")

            page.locator("input[type=file]").set_input_files(str(broken))
            page.get_by_role("button", name="开始上传").click()
            page.get_by_text("全部文件上传失败", exact=False).wait_for()
            page.get_by_text("文档解析失败", exact=False).wait_for()
            screenshot(page, args.output_dir / "parse-failure.png")
            results["ui_parse_failure_reason"] = "PASS"

            page.reload()
            page.wait_for_load_state("networkidle")
            blank = args.output_dir / "blank.txt"
            blank.write_text(" \n\t ", encoding="utf-8")
            page.locator("input[type=file]").set_input_files(str(blank))
            page.get_by_role("button", name="开始上传").click()
            page.get_by_text("文档内容为空", exact=False).wait_for()
            screenshot(page, args.output_dir / "empty-document.png")
            results["ui_empty_document_reason"] = "PASS"

            page.reload()
            page.wait_for_load_state("networkidle")
            good = args.output_dir / "mixed-good.txt"
            good.write_text("Valid knowledge for controlled mixed batch verification.", encoding="utf-8")
            page.locator("input[type=file]").set_input_files([str(good), str(broken)])
            with page.expect_response(lambda response: response.url.endswith("/api/knowledge/upload")) as mixed:
                page.get_by_role("button", name="开始上传").click()
            result = mixed.value.json()
            assert result["code"] == 0 and len(result["data"]) == 1, result
            page.get_by_text("部分文件上传失败", exact=False).wait_for()
            screenshot(page, args.output_dir / "partial-failure.png")
            results["ui_partial_failure_warning"] = "PASS"
        finally:
            browser.close()
    (args.output_dir / "results.json").write_text(json.dumps({
        "boundary": "Original Vue + real HTTP/ETL/Tika, controlled auth/SQLite/COS/embedding/Chroma read adapter",
        "checks": results,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(results))


if __name__ == "__main__":
    main()
