"""Actual Vue upload -> HTTP graph -> patient result, controlled external services."""

import argparse
import json
from pathlib import Path

import httpx
from playwright.sync_api import expect, sync_playwright

from web.tests.test_workflow import picture_bytes

API = "http://127.0.0.1:15281"
FRONTEND = "http://127.0.0.1:15282"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    output = parser.parse_args().output_dir
    output.mkdir(parents=True, exist_ok=True)
    errors = []
    workflows = {}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        patient = browser.new_context(viewport={"width": 1360, "height": 1100})
        patient.add_cookies([{"name": "SESSION", "value": "alice", "url": API}])
        page = patient.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        for mode, title, status, publication in [
            ("published", "处理完成", "COMPLETED", "PUBLISHED"),
            ("insufficient", "处理完成，结果受限", "COMPLETED_LIMITED", "NONE"),
            ("rejected", "处理完成，结果受限", "COMPLETED_LIMITED", "REJECTED"),
            ("clinical", "等待医生复核", "WAITING_HUMAN_REVIEW", "VALIDATED"),
        ]:
            httpx.post(API + "/__fixture/mode/" + mode).raise_for_status()
            page.goto(FRONTEND + "/diagnosis")
            page.wait_for_load_state("networkidle")
            page.get_by_label("选择眼底图片").set_input_files({
                "name": "fundus.png", "mimeType": "image/png", "buffer": picture_bytes()})
            with page.expect_response(lambda response: response.url == API + "/api/diagnosis/workflows"
                                      and response.request.method == "POST") as created:
                page.get_by_role("button", name="创建分析任务", exact=True).click()
            task = created.value.json()["data"]["workflowId"]
            expect(page.get_by_role("heading", name=title, exact=True)).to_be_visible()
            current = httpx.get(API + "/api/diagnosis/workflows/" + task, cookies={"SESSION": "alice"}).json()["data"]
            assert current["status"] == status and current["explanation"]["publicationStatus"] == publication
            if mode == "published":
                expect(page.get_by_role("heading", name="模型评估", exact=True)).to_be_visible()
                expect(page.get_by_role("heading", name="一般参考信息", exact=True)).to_be_visible()
                expect(page.get_by_role("heading", name="风险提示", exact=True)).to_be_visible()
                page.get_by_text("查看参考片段", exact=True).click()
                expect(page.locator("blockquote")).to_contain_text("青光眼是一类")
                page.set_viewport_size({"width": 390, "height": 844})
                assert page.locator('.workflow-explanation').evaluate("el => el.scrollWidth <= el.clientWidth")
                page.screenshot(path=str(output / "issue09-published-mobile.png"), full_page=True)
                page.set_viewport_size({"width": 1360, "height": 1100})
            else:
                expect(page.get_by_role("heading", name="模型评估", exact=True)).to_have_count(0)
                assert current["result"] is None
            if mode == "rejected":
                expect(page.get_by_text("解释声明未通过校验", exact=False)).to_be_visible()
                expect(page.get_by_text("参考资料证明您患有", exact=False)).to_have_count(0)
            if mode == "clinical":
                expect(page.get_by_text("需要医生最终临床复核", exact=False)).to_be_visible()
            page.screenshot(path=str(output / f"issue09-{mode}.png"), full_page=True)
            page.reload()
            expect(page.get_by_role("heading", name=title, exact=True)).to_be_visible()
            workflows[mode] = task

        page.goto(FRONTEND + "/diagnosis?workflow=" + workflows["published"])
        expect(page.get_by_role("heading", name="模型评估", exact=True)).to_be_visible()
        page.evaluate("document.documentElement.setAttribute('data-theme', 'dark')")
        dark_contrast = page.evaluate("""() => {
          const luminance = color => {
            const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(x => {
              const value = x / 255;
              return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
            });
            return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
          };
          const background = luminance(getComputedStyle(document.querySelector('.workflow-status')).backgroundColor);
          const foreground = luminance(getComputedStyle(document.querySelector('.workflow-explanation')).color);
          return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
        }""")
        assert dark_contrast >= 4.5, dark_contrast
        page.screenshot(path=str(output / "issue09-published-dark.png"), full_page=True)
        page.evaluate("document.documentElement.setAttribute('data-theme', 'light')")
        assert httpx.post(API + "/__fixture/withdraw").json()["code"] == 0
        page.reload()
        expect(page.get_by_role("heading", name="处理完成，结果受限", exact=True)).to_be_visible()
        expect(page.get_by_text("解释已扣留", exact=False)).to_be_visible()
        expect(page.get_by_role("heading", name="模型评估", exact=True)).to_have_count(0)
        page.screenshot(path=str(output / "issue09-withheld.png"), full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        page.screenshot(path=str(output / "issue09-withheld-mobile.png"), full_page=True)
        assert page.locator('.workflow-status').evaluate("el => el.scrollWidth <= el.clientWidth")
        existing_header_overflow = page.evaluate("document.documentElement.scrollWidth > innerWidth")
        browser.close()
    assert not errors, errors
    result = {"boundary": "Actual upload/HTTP/LangGraph/durable checkpoint saver/Vue/Chromium; SQLite and controlled external services/models",
        "published": True, "insufficient": True, "claimsRejected": True, "finalReviewWaiting": True,
        "refreshRestored": True, "revokedExplanationWithheld": True, "explanationOverflow": False,
        "existingHeaderOverflow": existing_header_overflow,
        "darkTextContrast": round(dark_contrast, 2),
        "workflows": workflows, "pageErrors": errors}
    (output / "issue09-ui-results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
