"""Opt-in live HTTP + original frontend verification for migration issue 01.

Run only against an isolated baseline environment. Credentials stay in a local
JSON file; output contains check results, never cookies or passwords.
"""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
from urllib.parse import urlparse

import httpx


def envelope(response, code=0):
    status = response.status_code if isinstance(response, httpx.Response) else response.status
    assert status == 200, f"HTTP {status}"
    body = response.json()
    assert set(body) == {"code", "msg", "data"}, "response envelope changed"
    assert body["code"] == code, f"expected code {code}, got {body['code']}"
    return body["data"]


def verify(args):
    for url in (args.api_url, args.frontend_url):
        assert urlparse(url).hostname in {"localhost", "127.0.0.1"}, "local baseline only"
    credentials = json.loads(args.login_file.read_text(encoding="utf-8"))
    checks = []
    with httpx.Client(base_url=args.api_url + "/", timeout=20) as client:
        envelope(client.get("user/get/login"), 40100)
        checks.append("anonymous_python_probe")
        envelope(client.post("user/login", json=credentials))
        envelope(client.get("user/get/login"))
        checks.append("python_login_and_probe")
        cookies = dict(client.cookies)
        assert "EYE_SESSION" in cookies, "Python session cookie missing"
        page = envelope(client.post("diagnosis/list/page/my", json={"pageSize": 3}))
        page_total = page["total"]
        assert set(page) >= {"records", "total", "size", "current", "pages"}
        assert page["size"] == "3"
        assert all(isinstance(page[k], str) for k in ("total", "size", "current", "pages"))
        checks.append("python_authenticated_query_and_pagination")
        assert all(isinstance(row["id"], str) for row in page["records"])
        checks.append("python_long_and_pagination_contract")
        if args.missing_weights:
            before = page["total"]
            envelope(client.post("diagnosis/diagnosis", files={
                "file": ("baseline.png", b"baseline-input", "image/png")
            }), 50000)
            after = envelope(client.post("diagnosis/list/page/my", json={}))
            assert after["total"] == before, "failed inference created a record"
            checks.append("missing_weights_fail_closed_no_record")
        envelope(client.post("user/logout"))
        # Replay the original cookie, rather than only relying on the browser
        # deleting it. Python logout must revoke the server-side session.
        with httpx.Client(base_url=args.api_url + "/", cookies=cookies, timeout=20) as replay:
            envelope(replay.get("user/get/login"), 40100)
            envelope(replay.post("diagnosis/list/page/my", json={}), 40100)
        checks.append("python_logout_old_cookie_revoked")

    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.goto(args.frontend_url + "/user/login")
            page.wait_for_load_state("networkidle")
            page.get_by_placeholder("请输入账号", exact=True).fill(credentials["userAccount"])
            page.get_by_placeholder("请输入密码", exact=True).fill(credentials["userPassword"])
            with page.expect_response(lambda r: r.url.endswith("/api/user/login")) as login:
                page.locator("button.login-button").click()
            envelope(login.value)
            page.wait_for_load_state("networkidle")
            page.goto(args.frontend_url + "/user/userCenter/profile")
            page.wait_for_load_state("networkidle")
            # The legacy user-center mount always redirects to profile. Use
            # its existing menu, as a person would, to open diagnosis history.
            with page.expect_response(lambda r: "/api/diagnosis/list/page/vo/cache" in r.url) as query:
                page.get_by_role("menuitem", name="诊断历史").click()
            data = envelope(query.value)
            assert isinstance(data["records"], list)
            frontend_total = data["total"]
            page.wait_for_load_state("networkidle")
            assert page.get_by_text("诊断历史", exact=True).count() > 0
            legacy_date_issue = "Invalid Date" in page.locator("body").inner_text()
            args.output_dir.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(args.output_dir / "frontend-history.png"), full_page=True)
            # End only this runner's browser session.
            logout = page.request.post(args.api_url + "/user/logout")
            envelope(logout)
            checks.append("original_frontend_login_and_python_history_query")
        finally:
            browser.close()
    return {"timestamp_utc": datetime.now(timezone.utc).isoformat(),
            "environment": "isolated real services; synthetic account; no real model acceptance",
            "http_history_total": page_total,
            "frontend_history_total": frontend_total,
            "legacy_frontend_invalid_date_observed": legacy_date_issue,
            "checks": checks}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default="http://localhost:8081/api")
    parser.add_argument("--frontend-url", default="http://localhost:5173")
    parser.add_argument("--login-file", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--missing-weights", action="store_true",
                        help="Only use when the isolated service has no weights configured")
    args = parser.parse_args()
    result = verify(args)
    (args.output_dir / "live-results.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
