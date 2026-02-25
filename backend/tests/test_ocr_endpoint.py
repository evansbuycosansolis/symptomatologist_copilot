from __future__ import annotations

import io
import sys
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main as backend_main  # noqa: E402


def _make_text_image_bytes() -> bytes:
    if backend_main.Image is None:
        raise RuntimeError("Pillow is not available")

    from PIL import ImageDraw, ImageFont

    img = backend_main.Image.new("RGB", (900, 260), "white")
    draw = ImageDraw.Draw(img)
    font = ImageFont.load_default()
    draw.multiline_text(
        (20, 20),
        "Patient: OCR TEST\nTemp 38.5 C\nHeadache and cough",
        fill="black",
        font=font,
        spacing=10,
    )
    img = img.resize((1800, 520))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


client = TestClient(backend_main.app)


def test_attachments_extract_image_ocr_returns_text():
    if backend_main.Image is None:
        import pytest

        pytest.skip("Pillow not installed")

    payload = _make_text_image_bytes()

    # Force local OCR path for the test (no cloud OCR fallback).
    with patch.object(backend_main, "OPENAI_CLIENT", None):
        resp = client.post(
            "/attachments/extract",
            files={"file": ("ocr_test.png", payload, "image/png")},
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body.get("ocr_engine") in {"rapidocr", "tesseract"}
    extracted = (body.get("extracted_text") or "").lower().replace(" ", "")
    assert "headacheandcough" in extracted
    assert ("patient" in extracted) or ("temp38.5c" in extracted)
