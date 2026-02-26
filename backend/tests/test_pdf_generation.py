from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main as backend_main  # noqa: E402


client = TestClient(backend_main.app)


def _assert_pdf_document(resp_json: dict) -> None:
    assert resp_json.get("ok") is True
    doc = resp_json.get("document") or {}
    assert str(doc.get("filename", "")).endswith(".pdf")
    rel = str(doc.get("path", "")).replace("/", "\\")
    assert rel
    abs_path = backend_main.DATA_ROOT / rel
    assert abs_path.exists(), f"Missing generated PDF at {abs_path}"
    assert abs_path.stat().st_size > 0


def test_generate_intake_pdf():
    resp = client.post(
        "/documents/intake_pdf",
        json={
            "intake": {
                "FullName": "PDF Test Intake",
                "DateOfBirth": "1990-01-01",
                "ChiefComplaint": "Headache for 2 days",
            },
            "enhanced_report": "Enhanced report test line.",
            "title": "Intake PDF Test",
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    _assert_pdf_document(data)
    assert "_INTAKE.pdf" in str(data.get("document", {}).get("filename", ""))
    assert "PDF Test Intake (1990-01-01)" in str(data.get("document", {}).get("filename", ""))


def test_generate_patient_record_pdf():
    resp = client.post(
        "/documents/patient_record_pdf",
        json={
            "note": "Doctor note for PDF export test.",
            "title": "Doctor Record PDF",
            "patient_name": "PDF Test Patient",
            "patient_dob": "1988-04-12",
            "source_role": "doctor",
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    _assert_pdf_document(data)
    assert "_DPR.pdf" in str(data.get("document", {}).get("filename", ""))
    assert "PDF Test Patient (1988-04-12)" in str(data.get("document", {}).get("filename", ""))


def test_generate_medical_certificate_pdf():
    resp = client.post(
        "/documents/medical_certificate_pdf",
        json={
            "patient_name": "Certificate Patient",
            "patient_dob": "1975-11-30",
            "diagnosis": "Upper respiratory infection",
            "recommendations": "Hydration, rest, follow-up in 3 days.",
            "rest_days": 2,
            "doctor_name": "Dr. Jane Doe",
            "clinic_name": "CoPilot Clinic",
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    _assert_pdf_document(data)
    assert "_MC.pdf" in str(data.get("document", {}).get("filename", ""))
    assert "Certificate Patient (1975-11-30)" in str(data.get("document", {}).get("filename", ""))


def test_builtin_pdf_engine_works_without_reportlab(monkeypatch):
    monkeypatch.setattr(backend_main, "canvas", None)
    monkeypatch.setattr(backend_main, "A4", None)
    monkeypatch.setattr(backend_main, "mm", None)

    pdf_bytes = backend_main._render_pdf_document(
        "Fallback Engine Test",
        [
            ("Section A", "Line 1\nLine 2"),
            ("Section B", "Another line"),
        ],
    )
    assert pdf_bytes.startswith(b"%PDF-1.")
    assert b"/Type /Catalog" in pdf_bytes
    assert b"/Type /Page" in pdf_bytes


def test_generate_intake_pdf_without_reportlab(monkeypatch):
    monkeypatch.setattr(backend_main, "canvas", None)
    monkeypatch.setattr(backend_main, "A4", None)
    monkeypatch.setattr(backend_main, "mm", None)

    resp = client.post(
        "/documents/intake_pdf",
        json={
            "intake": {
                "FullName": "Fallback PDF Intake",
                "DateOfBirth": "1990-01-01",
                "ChiefComplaint": "Cough",
            },
            "enhanced_report": "Fallback intake report.",
            "title": "Fallback Intake PDF",
        },
    )
    assert resp.status_code == 200, resp.text
    _assert_pdf_document(resp.json())
