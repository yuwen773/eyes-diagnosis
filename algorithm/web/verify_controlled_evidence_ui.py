"""Chromium + actual local API/Vue, controlled service doubles only.

Run with web.tests.controlled_evidence_ui_server on 15281 and Vite on 15282,
VITE_API_BASE_URL=http://127.0.0.1:15281/api. Ports are verifier-only.
"""

import argparse
import json
from pathlib import Path

import httpx
from playwright.sync_api import expect, sync_playwright

API = "http://127.0.0.1:15281"
FRONTEND = "http://127.0.0.1:15282"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    output = parser.parse_args().output_dir
    output.mkdir(parents=True, exist_ok=True)
    ids = httpx.get(API + "/__fixture").json()
    errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        patient = browser.new_context(viewport={"width": 1360, "height": 1000})
        patient.add_cookies([{"name": "SESSION", "value": "alice", "url": API}])
        page = patient.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(FRONTEND + "/diagnosis?workflow=" + ids["sufficient"])
        page.wait_for_load_state("networkidle")
        expect(page.get_by_role("heading", name="一般参考资料")).to_be_visible()
        expect(page.get_by_text("引用：", exact=False)).to_contain_text("doc_1_chunk_0")
        page.screenshot(path=str(output / "issue08-evidence.png"), full_page=True)
        page.reload()
        expect(page.get_by_role("heading", name="一般参考资料")).to_be_visible()
        page.goto(FRONTEND + "/diagnosis?workflow=" + ids["insufficient"])
        expect(page.get_by_role("heading", name="证据不足", exact=True)).to_be_visible()
        expect(page.get_by_text("已尝试一次查询改写", exact=False)).to_be_visible()
        page.screenshot(path=str(output / "issue08-insufficient.png"), full_page=True)

        admin = browser.new_context(viewport={"width": 1440, "height": 1100})
        admin.add_cookies([{"name": "SESSION", "value": "admin", "url": API}])
        review = admin.new_page()
        review.on("pageerror", lambda error: errors.append(str(error)))
        review.goto(FRONTEND + "/admin/knowledge")
        review.wait_for_load_state("networkidle")
        review.get_by_role("button", name="审核属性").click()
        expect(review.get_by_role("button", name="确认保存审核变更")).to_be_disabled()
        review.get_by_label("审核状态", exact=True).select_option("WITHDRAWN")
        review.get_by_label("确认审核变更", exact=True).check()
        review.screenshot(path=str(output / "issue08-review-confirmation.png"), full_page=True)
        review.evaluate("document.documentElement.setAttribute('data-theme', 'dark')")
        review.screenshot(path=str(output / "issue08-review-dark.png"), full_page=True)
        review.evaluate("document.documentElement.setAttribute('data-theme', 'light')")
        review.get_by_role("button", name="确认保存审核变更").click()
        expect(review.get_by_text("审核属性已保存", exact=True)).to_be_visible()
        page.goto(FRONTEND + "/diagnosis?workflow=" + ids["sufficient"])
        expect(page.get_by_role("heading", name="证据不足", exact=True)).to_be_visible()
        expect(page.get_by_text("原参考资料已撤回", exact=False)).to_be_visible()
        expect(page.get_by_text("引用：", exact=False)).to_have_count(0)
        page.screenshot(path=str(output / "issue08-withdrawn.png"), full_page=True)
        page.goto(FRONTEND + "/admin/knowledge")
        expect(page).to_have_url(FRONTEND + "/noAuth")
        browser.close()
    assert not errors, errors
    result = {"boundary": "SQLite + synthetic Java/COS/Chroma/embedding/inference; actual HTTP/Vue/Chromium",
              "sourceTraceable": True, "refreshRestored": True, "rewriteLimited": True,
              "adminConfirmedWithdrawal": True, "revokedReferenceHidden": True,
              "patientDeniedAdmin": True, "pageErrors": errors}
    (output / "issue08-ui-results.json").write_bytes(
        (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
