"""Browser-render the registered synthetic COS probe; no upload or bucket mutation."""
import hashlib
import io
import json
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent
RUN = OUT.parent
source = RUN / "20261017T100907-extra-http.json"
prior = json.loads(source.read_text(encoding="utf-8"))
probe = next(obj for obj in prior["objects"] if obj["kind"] == "retained-synthetic-sdk-picture-probe")
buffer = io.BytesIO()
Image.new("RGB", (32, 24), "white").save(buffer, "PNG")
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, args=["--no-proxy-server"])
    try:
        page = browser.new_page(viewport={"width": 700, "height": 400})
        response = page.goto(probe["url"], wait_until="networkidle", timeout=45000)
        assert response is not None and response.status == 200
        page.wait_for_function("document.images.length === 1 && document.images[0].complete && document.images[0].naturalWidth > 0")
        dimensions = page.locator("img").evaluate("img => ({width: img.naturalWidth, height: img.naturalHeight})")
        assert dimensions == {"width": 32, "height": 24}
        actual = hashlib.sha256(response.body()).hexdigest()
        assert actual == hashlib.sha256(buffer.getvalue()).hexdigest()
        page.screenshot(path=str(OUT / "cos-browser.png"), full_page=True)
        result = {"status": "PASS", "scope": "Native headless Chromium; previously registered synthetic white COS probe only",
            "sourceEvidence": source.name, "httpStatus": response.status, "contentType": response.headers.get("content-type"),
            "naturalDimensions": dimensions, "contentSha256": actual, "newObjects": 0, "screenshot": "cos-browser.png"}
    finally:
        browser.close()
(OUT / "cos-browser.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result))
