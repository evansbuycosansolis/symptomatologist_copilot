from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main as backend_main  # noqa: E402


client = TestClient(backend_main.app)


def test_pdf_extract_returns_user_message_when_no_readable_text(monkeypatch):
    monkeypatch.setattr(backend_main, "_extract_pdf_text", lambda _content: "")

    resp = client.post(
        "/attachments/extract",
        files={
            "file": ("lab_result.pdf", b"%PDF-1.4\n%empty\n", "application/pdf"),
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data.get("ocr_engine") == "pdf-text"
    assert data.get("extracted_text") == ""
    assert "No readable text found in PDF." in str(data.get("message", ""))


def test_extract_pdf_uses_image_ocr_fallback_when_text_layer_empty(monkeypatch):
    class _FakeImage:
        data = b"fake-image-bytes"

    class _FakePage:
        def extract_text(self):
            return ""

        @property
        def images(self):
            return [_FakeImage()]

    class _FakeReader:
        def __init__(self, _stream):
            self.pages = [_FakePage()]

    monkeypatch.setattr(backend_main, "PdfReader", _FakeReader)
    monkeypatch.setattr(backend_main, "_ocr_image_with_tesseract", lambda _b: "OCR PDF IMAGE TEXT")
    monkeypatch.setattr(backend_main, "_ocr_image_with_rapidocr", lambda _b: "")
    monkeypatch.setattr(backend_main, "_ocr_image_with_openai_vision", lambda _b, _c: "")

    text = backend_main._extract_pdf_text(b"%PDF-1.4")
    assert "OCR PDF IMAGE TEXT" in text


def test_lab_attachment_uses_patient_dob_naming(monkeypatch):
    monkeypatch.setattr(
        backend_main,
        "extract_text_with_meta_from_upload",
        lambda _content, _filename, _ctype: ("CBC normal", "mock-ocr", ""),
    )

    resp = client.post(
        "/attachments/extract",
        files={"file": ("cbc.jpg", b"fake-jpg", "image/jpeg")},
        data={
            "patient_name": "John Doe",
            "patient_dob": "1990-01-01",
            "lab_slot": "2",
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    filename = str(data.get("filename", ""))
    assert "John Doe (1990-01-01)" in filename
    assert filename.endswith("_LR2.jpg")
    assert data.get("extracted_text") == "CBC normal"
