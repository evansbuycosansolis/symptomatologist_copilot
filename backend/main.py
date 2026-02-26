from __future__ import annotations

import io
import json
import os
import re
import sys
import textwrap
import uuid
import base64
import hashlib
import hmac
import smtplib
import threading
import time
from datetime import datetime, timezone, timedelta
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Literal

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

OPENAI_IMPORT_ERROR = ""
try:
    from openai import OpenAI
except Exception as _e:  # optional runtime dependency
    OpenAI = None  # type: ignore[assignment]
    try:
        OPENAI_IMPORT_ERROR = f"{type(_e).__name__}: {_e}"
    except Exception:
        OPENAI_IMPORT_ERROR = "(unknown import error)"

try:
    from pypdf import PdfReader
except Exception:  # optional runtime dependency
    PdfReader = None  # type: ignore[assignment]

try:
    import numpy as np
except Exception:  # optional runtime dependency
    np = None  # type: ignore[assignment]

try:
    from PIL import Image, ImageEnhance, ImageOps
except Exception:  # optional runtime dependency
    Image = None  # type: ignore[assignment]
    ImageEnhance = None  # type: ignore[assignment]
    ImageOps = None  # type: ignore[assignment]

try:
    import pytesseract
except Exception:  # optional runtime dependency
    pytesseract = None  # type: ignore[assignment]

try:
    from rapidocr_onnxruntime import RapidOCR
except Exception:  # optional runtime dependency
    RapidOCR = None  # type: ignore[assignment]

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas
except Exception:  # optional runtime dependency
    A4 = None  # type: ignore[assignment]
    mm = None  # type: ignore[assignment]
    canvas = None  # type: ignore[assignment]


def _base_dir() -> Path:
    # When packaged with PyInstaller, __file__ points inside the temporary bundle
    # extraction directory. For a portable EXE, we want runtime files (storage, .env,
    # optional static web assets) to live next to the executable.
    if getattr(sys, "frozen", False) and getattr(sys, "executable", None):
        try:
            return Path(sys.executable).resolve().parent
        except Exception:
            return Path.cwd()
    return Path(__file__).resolve().parent


BASE_DIR = _base_dir()
# Use override=True so the portable folder's .env always wins over any machine-level
# environment variables (common source of confusion on shared PCs).
# Use utf-8-sig so BOM-prefixed .env files (common on some Windows editors/PowerShell)
# don't break reading the first key (e.g., OPENAI_API_KEY).
load_dotenv(BASE_DIR / ".env", override=True, encoding="utf-8-sig")

DATA_ROOT = BASE_DIR / "storage" / "webapp"
INTAKES_DIR = DATA_ROOT / "intakes"
PATIENT_RECORDS_DIR = DATA_ROOT / "patient_records"
APPOINTMENTS_DIR = DATA_ROOT / "appointments"
UPLOADS_DIR = DATA_ROOT / "uploads"
KB_DIR = DATA_ROOT / "kb"
DOCUMENTS_DIR = DATA_ROOT / "documents"
MANIFESTS_DIR = DATA_ROOT / "manifests"
for _p in (
    INTAKES_DIR,
    PATIENT_RECORDS_DIR,
    APPOINTMENTS_DIR,
    UPLOADS_DIR / "pdfs",
    UPLOADS_DIR / "attachments",
    KB_DIR / "docs",
    KB_DIR / "texts",
    DOCUMENTS_DIR / "pdfs",
    MANIFESTS_DIR,
):
    _p.mkdir(parents=True, exist_ok=True)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000").strip() or "http://localhost:3000"
HOST = os.getenv("HOST", "127.0.0.1").strip() or "127.0.0.1"
PORT = int(os.getenv("PORT", "8080"))
DOCTOR_PIN = (os.getenv("DOCTOR_PIN", "docbayson888#").strip() or "docbayson888#")
ASSISTANT_PIN = (os.getenv("ASSISTANT_PIN", "assistant123").strip() or "assistant123")
AUTH_SECRET = (
    os.getenv("AUTH_SECRET", "").strip()
    or OPENAI_API_KEY
    or "copilot-change-this-auth-secret"
)
AUTH_COOKIE_NAME = (os.getenv("AUTH_COOKIE_NAME", "copilot_session").strip() or "copilot_session")
try:
    AUTH_TTL_SECONDS = max(300, int(os.getenv("AUTH_TTL_SECONDS", "43200").strip() or "43200"))
except Exception:
    AUTH_TTL_SECONDS = 43200
AUTH_COOKIE_SECURE = (os.getenv("AUTH_COOKIE_SECURE", "0").strip() or "0") in ("1", "true", "True")
AUTH_COOKIE_PERSIST = (os.getenv("AUTH_COOKIE_PERSIST", "0").strip() or "0") in ("1", "true", "True")

OPENAI_CLIENT = None
OPENAI_INIT_ERROR = ""
if OPENAI_API_KEY and OpenAI is not None:
    try:
        OPENAI_CLIENT = OpenAI(api_key=OPENAI_API_KEY)
    except Exception as _e:
        OPENAI_CLIENT = None
        try:
            OPENAI_INIT_ERROR = f"OpenAI client initialization failed: {type(_e).__name__}: {_e}"
        except Exception:
            OPENAI_INIT_ERROR = "OpenAI client initialization failed."
elif OPENAI_API_KEY and OpenAI is None:
    OPENAI_INIT_ERROR = "OpenAI Python package is not available in this build."


def _openai_version() -> str:
    try:
        import openai  # type: ignore

        return getattr(openai, "__version__", "") or ""
    except Exception:
        return ""

_RAPIDOCR_ENGINE = None
_RAPIDOCR_INIT_FAILED = False


def _get_rapidocr_engine():
    global _RAPIDOCR_ENGINE, _RAPIDOCR_INIT_FAILED
    if _RAPIDOCR_ENGINE is not None:
        return _RAPIDOCR_ENGINE
    if _RAPIDOCR_INIT_FAILED or RapidOCR is None:
        return None
    try:
        _RAPIDOCR_ENGINE = RapidOCR()
        return _RAPIDOCR_ENGINE
    except Exception:
        _RAPIDOCR_INIT_FAILED = True
        return None


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _local_tzinfo():
    try:
        return datetime.now().astimezone().tzinfo or timezone.utc
    except Exception:
        return timezone.utc


def parse_iso_dt(value: str) -> datetime:
    raw = (value or "").strip()
    if not raw:
        raise ValueError("Datetime is required")
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_local_tzinfo())
    return dt.astimezone(timezone.utc)


def iso_utc(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def overlaps(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> bool:
    return a_start < b_end and b_start < a_end


def now_stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def now_stamp_ms() -> str:
    # WinForms-compatible filename timestamp style: yyyyMMdd_HHmmss_fff
    return datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]


def sanitize_filename(name: str, fallback: str = "file") -> str:
    cleaned = re.sub(r"[^\w.\-() ]+", "_", (name or "").strip()).strip(" .")
    return cleaned or fallback


def slugify(text: str, fallback: str = "record") -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (text or "").strip().lower()).strip("_")
    return s or fallback


def _patient_name_dob_parts(
    full_name: str,
    dob: str,
    *,
    fallback_name: str = "Unknown Patient",
    fallback_dob: str = "Unknown DOB",
) -> tuple[str, str]:
    safe_name = sanitize_filename((full_name or "").strip() or fallback_name, fallback_name)
    safe_dob = sanitize_filename((dob or "").strip() or fallback_dob, fallback_dob)
    return safe_name, safe_dob


def _patient_file_prefix(
    full_name: str,
    dob: str,
    *,
    fallback_name: str = "Unknown Patient",
    fallback_dob: str = "Unknown DOB",
) -> str:
    safe_name, safe_dob = _patient_name_dob_parts(
        full_name,
        dob,
        fallback_name=fallback_name,
        fallback_dob=fallback_dob,
    )
    return f"{safe_name} ({safe_dob}) {now_stamp_ms()}"


def _extract_labeled_value(text: str, labels: list[str]) -> str:
    lines = (text or "").replace("\r", "\n").split("\n")
    for raw in lines:
        line = (raw or "").strip()
        if not line:
            continue
        lower = line.lower()
        for label in labels:
            lbl = (label or "").strip()
            if not lbl:
                continue
            if lower.startswith(lbl.lower()):
                return line[len(lbl) :].strip()
    return ""


def _extract_bracketed_prefix_value(text: str, prefix: str) -> str:
    for raw in (text or "").replace("\r", "\n").split("\n"):
        line = (raw or "").strip()
        if not line:
            continue
        if line.lower().startswith(prefix.lower()):
            return line[len(prefix) :].strip()
    return ""


def _json_object_from_text(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    if not raw:
        return {}
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else {}
    except Exception:
        pass

    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        snippet = raw[start : end + 1]
        try:
            obj = json.loads(snippet)
            return obj if isinstance(obj, dict) else {}
        except Exception:
            return {}
    return {}


def _safe_int(value: Any, default: int, *, min_value: int = 0, max_value: int = 365) -> int:
    try:
        n = int(value)
    except Exception:
        return default
    return max(min_value, min(max_value, n))


def _wrap_pdf_lines(text: str, width_chars: int = 105) -> list[str]:
    out: list[str] = []
    for raw in (text or "").replace("\r", "\n").split("\n"):
        line = raw.rstrip()
        if not line:
            out.append("")
            continue
        wrapped = textwrap.wrap(
            line,
            width=max(20, width_chars),
            replace_whitespace=False,
            drop_whitespace=False,
            break_long_words=False,
            break_on_hyphens=False,
        )
        if not wrapped:
            out.append("")
        else:
            out.extend(wrapped)
    return out


def _pdf_escape_text(text: str) -> str:
    normalized = (text or "").replace("\r", " ").replace("\n", " ")
    normalized = normalized.encode("latin-1", "replace").decode("latin-1")
    return normalized.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _build_minimal_pdf(page_streams: list[str]) -> bytes:
    streams = page_streams or [""]
    page_count = len(streams)

    # 1: Catalog, 2: Pages, 3: Helvetica, 4: Helvetica-Bold
    max_obj_id = 4 + (page_count * 2)
    objects: list[bytes] = [b""] * (max_obj_id + 1)

    page_ids: list[int] = []
    for i, stream in enumerate(streams):
        content_id = 5 + (i * 2)
        page_id = 6 + (i * 2)
        page_ids.append(page_id)

        stream_bytes = (stream or "").encode("latin-1", "replace")
        objects[content_id] = (
            f"<< /Length {len(stream_bytes)} >>\nstream\n".encode("ascii")
            + stream_bytes
            + b"\nendstream"
        )
        objects[page_id] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> "
            f"/Contents {content_id} 0 R >>"
        ).encode("ascii")

    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    objects[2] = f"<< /Type /Pages /Count {page_count} /Kids [{kids}] >>".encode("ascii")
    objects[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objects[3] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    objects[4] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")

    offsets = [0] * (max_obj_id + 1)
    for obj_id in range(1, max_obj_id + 1):
        offsets[obj_id] = out.tell()
        out.write(f"{obj_id} 0 obj\n".encode("ascii"))
        out.write(objects[obj_id])
        if not objects[obj_id].endswith(b"\n"):
            out.write(b"\n")
        out.write(b"endobj\n")

    xref_pos = out.tell()
    out.write(f"xref\n0 {max_obj_id + 1}\n".encode("ascii"))
    out.write(b"0000000000 65535 f \n")
    for obj_id in range(1, max_obj_id + 1):
        out.write(f"{offsets[obj_id]:010d} 00000 n \n".encode("ascii"))

    out.write(f"trailer\n<< /Size {max_obj_id + 1} /Root 1 0 R >>\n".encode("ascii"))
    out.write(f"startxref\n{xref_pos}\n%%EOF".encode("ascii"))
    return out.getvalue()


def _render_pdf_document_fallback(title: str, sections: list[tuple[str, str]]) -> bytes:
    page_h = 842.0
    margin = 45.0
    line_h = 14.0
    y = page_h - margin
    pages: list[list[str]] = [[]]

    def new_page() -> None:
        nonlocal y
        pages.append([])
        y = page_h - margin

    def ensure_space(lines_needed: int = 1) -> None:
        nonlocal y
        if y - (line_h * max(1, lines_needed)) < margin:
            new_page()

    def write_line(text: str, *, font: str = "F1", size: int = 10) -> None:
        nonlocal y
        ensure_space(1)
        safe = _pdf_escape_text((text or "")[:1400])
        pages[-1].append(
            f"BT /{font} {size} Tf 1 0 0 1 {margin:.2f} {y:.2f} Tm ({safe}) Tj ET"
        )
        y -= line_h

    ensure_space(2)
    write_line((title or "Document").strip()[:120], font="F2", size=16)
    y -= 4
    write_line(f"Generated: {datetime.now():%Y-%m-%d %H:%M:%S}", font="F1", size=8)
    y -= 2

    for heading, content in sections:
        section_title = (heading or "").strip()
        section_body = (content or "").strip()
        if not section_title and not section_body:
            continue

        write_line(section_title[:120] or "Section", font="F2", size=12)
        lines = _wrap_pdf_lines(section_body, width_chars=92) or [""]
        for ln in lines:
            write_line(ln, font="F1", size=10)
        y -= 4

    streams = ["\n".join(cmds) for cmds in pages if cmds]
    return _build_minimal_pdf(streams)


def _render_pdf_document(title: str, sections: list[tuple[str, str]]) -> bytes:
    if canvas is None or A4 is None or mm is None:
        return _render_pdf_document_fallback(title, sections)

    try:
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=A4)
        page_w, page_h = A4
        margin = 16 * mm
        line_h = 14
        body_font = "Helvetica"
        body_size = 10
        heading_font = "Helvetica-Bold"
        heading_size = 12
        y = page_h - margin

        def new_page() -> None:
            nonlocal y
            c.showPage()
            y = page_h - margin

        def ensure_space(lines_needed: int = 1) -> None:
            nonlocal y
            if y - (line_h * max(1, lines_needed)) < margin:
                new_page()

        ensure_space(2)
        c.setFont("Helvetica-Bold", 16)
        c.drawString(margin, y, (title or "Document").strip()[:120])
        y -= (line_h + 6)
        c.setFont(body_font, 8)
        c.drawString(margin, y, f"Generated: {datetime.now():%Y-%m-%d %H:%M:%S}")
        y -= (line_h + 2)

        for heading, content in sections:
            section_title = (heading or "").strip()
            section_body = (content or "").strip()
            if not section_title and not section_body:
                continue

            ensure_space(2)
            c.setFont(heading_font, heading_size)
            c.drawString(margin, y, section_title[:120] or "Section")
            y -= line_h

            c.setFont(body_font, body_size)
            lines = _wrap_pdf_lines(section_body, width_chars=108) or [""]
            for ln in lines:
                ensure_space(1)
                c.drawString(margin, y, ln[:1400])
                y -= line_h
            y -= 4

        c.save()
        return buf.getvalue()
    except Exception:
        return _render_pdf_document_fallback(title, sections)


def _store_generated_pdf(
    *,
    filename_stem: str,
    pdf_bytes: bytes,
    document_type: str,
    title: str,
    patient_name: str = "",
    patient_dob: str = "",
    naming_suffix: str = "",
) -> dict[str, Any]:
    doc_id = uuid.uuid4().hex[:12]
    if (patient_name or "").strip():
        safe_name, safe_dob = _patient_name_dob_parts(
            patient_name,
            patient_dob,
            fallback_name="Unknown Patient",
            fallback_dob="Unknown DOB",
        )
        suffix = slugify((naming_suffix or document_type or "document"), "document").upper()
        filename = f"{safe_name} ({safe_dob}) {now_stamp_ms()}_{suffix}.pdf"
    else:
        filename = f"{now_stamp()}_{slugify(filename_stem, 'document')}_{doc_id}.pdf"

    path = DOCUMENTS_DIR / "pdfs" / filename
    if path.exists():
        path = DOCUMENTS_DIR / "pdfs" / f"{path.stem}_{doc_id[:6]}.pdf"
        filename = path.name
    path.write_bytes(pdf_bytes)
    rel = str(path.relative_to(DATA_ROOT)).replace("\\", "/")
    item = {
        "id": doc_id,
        "document_type": document_type,
        "title": (title or "").strip(),
        "patient_name": (patient_name or "").strip(),
        "patient_dob": (patient_dob or "").strip(),
        "filename": filename,
        "path": rel,
        "created_at": now_iso(),
        "size_bytes": len(pdf_bytes),
    }
    _upsert_manifest("pdf_documents", item)
    return {
        **item,
        "stored_path": f"/storage/{rel}",
    }


def _manifest_path(name: str) -> Path:
    return MANIFESTS_DIR / f"{name}.json"


def _load_manifest(name: str) -> dict[str, Any]:
    path = _manifest_path(name)
    if not path.exists():
        return {"items": []}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"items": []}


def _save_manifest(name: str, data: dict[str, Any]) -> None:
    _manifest_path(name).write_text(json.dumps(data, indent=2), encoding="utf-8")


def _upsert_manifest(name: str, item: dict[str, Any], key: str = "id") -> None:
    m = _load_manifest(name)
    items = m.setdefault("items", [])
    for i, existing in enumerate(items):
        if existing.get(key) == item.get(key):
            items[i] = item
            _save_manifest(name, m)
            return
    items.append(item)
    _save_manifest(name, m)


def _extract_pdf_text(content: bytes) -> str:
    if PdfReader is None:
        return ""
    try:
        reader = PdfReader(io.BytesIO(content))
    except Exception:
        return ""

    # 1) Try native text layer extraction first.
    text_chunks: list[str] = []
    for page in reader.pages[:10]:
        try:
            txt = (page.extract_text() or "").strip()
        except Exception:
            txt = ""
        if txt:
            text_chunks.append(txt)
    text_layer = _normalize_ocr_text("\n\n".join(text_chunks))
    if len(re.sub(r"\W+", "", text_layer)) >= 25:
        return text_layer

    # 2) OCR fallback for image-based/scanned PDFs: OCR embedded images per page.
    ocr_chunks: list[str] = []
    for page in reader.pages[:10]:
        try:
            images = list(getattr(page, "images", []) or [])
        except Exception:
            images = []
        for img in images[:8]:
            try:
                data = getattr(img, "data", b"")
            except Exception:
                data = b""
            if not data:
                continue
            ocr_text = (
                _ocr_image_with_tesseract(data)
                or _ocr_image_with_rapidocr(data)
                or _ocr_image_with_openai_vision(data, None)
            )
            clean = _normalize_ocr_text(ocr_text)
            if clean:
                ocr_chunks.append(clean)
        if len(ocr_chunks) >= 12:
            break

    ocr_layer = _normalize_ocr_text("\n\n".join(ocr_chunks))
    if ocr_layer and text_layer:
        return _normalize_ocr_text(f"{text_layer}\n\n{ocr_layer}")
    if ocr_layer:
        return ocr_layer
    return text_layer


def _normalize_ocr_text(text: str) -> str:
    if not text:
        return ""
    lines = []
    for raw in text.replace("\r", "\n").split("\n"):
        line = re.sub(r"\s+", " ", raw).strip()
        if line:
            lines.append(line)
    return "\n".join(lines).strip()


def _candidate_tesseract_cmds() -> list[str]:
    env_cmd = os.getenv("TESSERACT_CMD", "").strip()
    cmds = [
        env_cmd,
        str(BASE_DIR / "tesseract" / "tesseract.exe"),
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ]
    return [c for c in cmds if c]


def _candidate_tessdata_dirs() -> list[Path]:
    env_dir = os.getenv("TESSDATA_DIR", "").strip()
    dirs = [
        Path(env_dir) if env_dir else None,
        BASE_DIR / "tessdata",
        Path(r"C:\Program Files\Tesseract-OCR\tessdata"),
        Path(r"C:\Program Files (x86)\Tesseract-OCR\tessdata"),
    ]
    return [d for d in dirs if d is not None]


def _image_variants_for_ocr(content: bytes) -> list[Any]:
    if Image is None or ImageOps is None:
        return []
    try:
        base = Image.open(io.BytesIO(content))
        base.load()
        base = ImageOps.exif_transpose(base).copy()
        if base.mode not in ("RGB", "L"):
            base = base.convert("RGB").copy()
    except Exception:
        return []

    variants: list[Any] = [base]
    try:
        gray = ImageOps.grayscale(base)
        variants.append(gray)
        if ImageEnhance is not None:
            contrast = ImageEnhance.Contrast(gray).enhance(2.0)
            variants.append(contrast)
            sharp = ImageEnhance.Sharpness(contrast).enhance(1.6)
            variants.append(sharp)
            bw = sharp.point(lambda p: 255 if p > 165 else 0)
            variants.append(bw)
    except Exception:
        pass

    resized: list[Any] = []
    for img in variants:
        try:
            w, h = img.size
            if max(w, h) < 1800:
                scale = max(2, int(1800 / max(1, max(w, h))) + 1)
                resized.append(img.resize((w * scale, h * scale)))
        except Exception:
            continue
    variants.extend(resized)
    return variants


def _ocr_image_with_tesseract(content: bytes) -> str:
    if pytesseract is None or Image is None:
        return ""

    tesseract_cmd = next((c for c in _candidate_tesseract_cmds() if Path(c).exists()), "")
    if not tesseract_cmd:
        return ""

    try:
        pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
    except Exception:
        return ""

    tessdata_dir = next((d for d in _candidate_tessdata_dirs() if d.exists()), None)
    config = "--oem 3 --psm 6"
    if tessdata_dir is not None:
        config += f' --tessdata-dir "{tessdata_dir}"'

    best = ""
    for img in _image_variants_for_ocr(content):
        try:
            text = pytesseract.image_to_string(img, lang="eng", config=config)
        except Exception:
            continue
        text = _normalize_ocr_text(text)
        if len(re.sub(r"\W+", "", text)) > len(re.sub(r"\W+", "", best)):
            best = text
    return best


def _rapidocr_result_to_text(result: Any) -> str:
    if not result:
        return ""
    lines: list[str] = []
    for row in result:
        try:
            line = str(row[1]).strip()
        except Exception:
            line = ""
        if line:
            lines.append(line)
    return _normalize_ocr_text("\n".join(lines))


def _ocr_image_with_rapidocr(content: bytes) -> str:
    if Image is None or np is None:
        return ""
    engine = _get_rapidocr_engine()
    if engine is None:
        return ""

    best = ""
    for img in _image_variants_for_ocr(content):
        try:
            arr = np.array(img)
            result, _ = engine(arr)
        except Exception:
            continue
        text = _rapidocr_result_to_text(result)
        if len(re.sub(r"\W+", "", text)) > len(re.sub(r"\W+", "", best)):
            best = text
    return best


def _ocr_image_with_openai_vision(content: bytes, content_type: str | None) -> str:
    if OPENAI_CLIENT is None:
        return ""
    mime = (content_type or "").strip() or "image/png"
    try:
        b64 = base64.b64encode(content).decode("ascii")
        resp = OPENAI_CLIENT.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0,
            messages=[
                {
                    "role": "system",
                    "content": "Extract the visible text from the image. Return plain text only. Do not summarize.",
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Extract all readable text from this medical image/lab image."},
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                    ],
                },
            ],
        )
        text = (resp.choices[0].message.content or "").strip()
        return _normalize_ocr_text(text)
    except Exception:
        return ""


def extract_text_with_meta_from_upload(
    content: bytes, filename: str, content_type: str | None
) -> tuple[str, str | None, str | None]:
    lower = (filename or "").lower()
    ctype = (content_type or "").lower()
    if lower.endswith(".pdf") or ctype == "application/pdf":
        text = _extract_pdf_text(content)
        if text:
            return text, "pdf-text", None
        return "", "pdf-text", "No readable text found in PDF."
    if lower.endswith((".txt", ".md", ".csv", ".json")) or ctype.startswith("text/"):
        for enc in ("utf-8", "latin-1"):
            try:
                return content.decode(enc), "text-decode", None
            except Exception:
                pass
        return "", "text-decode", "Text decoding failed."
    if lower.endswith((".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff")) or ctype.startswith("image/"):
        text = _ocr_image_with_tesseract(content)
        if text:
            return text, "tesseract", None
        text = _ocr_image_with_rapidocr(content)
        if text:
            return text, "rapidocr", None
        text = _ocr_image_with_openai_vision(content, content_type)
        if text:
            return text, "openai-vision", None

        if any(Path(c).exists() for c in _candidate_tesseract_cmds()) or _get_rapidocr_engine() is not None or OPENAI_CLIENT is not None:
            return "", None, "OCR ran but no readable text was detected."
        return "", None, "No OCR engine available (install local OCR deps or configure OPENAI_API_KEY)."
    return "", None, None


def extract_text_from_upload(content: bytes, filename: str, content_type: str | None) -> str:
    text, _, _ = extract_text_with_meta_from_upload(content, filename, content_type)
    return text


def chunk_text(text: str, size: int = 1400, overlap: int = 200) -> list[str]:
    t = (text or "").strip()
    if not t:
        return []
    out: list[str] = []
    i = 0
    while i < len(t):
        j = min(len(t), i + size)
        out.append(t[i:j])
        if j >= len(t):
            break
        i = max(i + 1, j - overlap)
    return out


def _tokens(text: str) -> set[str]:
    return {x for x in re.findall(r"[a-zA-Z][a-zA-Z0-9]{2,}", (text or "").lower())}


def retrieve_snippets(text: str, query: str, limit: int = 3) -> list[str]:
    q = _tokens(query)
    chunks = chunk_text(text)
    if not chunks:
        return []
    if not q:
        return chunks[:limit]
    scored: list[tuple[int, int, str]] = []
    for idx, chunk in enumerate(chunks):
        score = len(q.intersection(_tokens(chunk)))
        if score:
            scored.append((score, -idx, chunk))
    if not scored:
        return chunks[:1]
    scored.sort(reverse=True)
    return [c for _, _, c in scored[:limit]]


def openai_chat(messages: list[dict[str, str]]) -> str | None:
    if OPENAI_CLIENT is None:
        return None
    try:
        resp = OPENAI_CLIENT.chat.completions.create(
            model=OPENAI_MODEL,
            messages=messages,
            temperature=0.2,
        )
        return (resp.choices[0].message.content or "").strip() or None
    except Exception:
        return None


def fallback_chat(history: list["ChatMessage"]) -> str:
    for msg in reversed(history):
        if msg.role.lower() == "user" and msg.content.strip():
            text = msg.content.strip()
            if len(text) > 600:
                text = text[:600] + "..."
            reason = "missing OPENAI_API_KEY"
            if OPENAI_API_KEY:
                reason = (
                    OPENAI_INIT_ERROR.strip()
                    or (f"OpenAI import failed: {OPENAI_IMPORT_ERROR}" if OPENAI_IMPORT_ERROR else "")
                    or "LLM is not available (initialization failed)"
                )
            return (
                f"LLM is not available ({reason}). Local fallback response only.\n\n"
                f"Last user message:\n{text}"
            )
    return "No user message provided."


def parse_tags_csv(tags: str | None) -> list[str]:
    if not tags:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for part in tags.split(","):
        t = part.strip()
        if not t:
            continue
        key = t.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(t)
    return out


def _save_blob(folder: Path, filename: str, content: bytes) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    stem = slugify(Path(filename).stem, "file")
    suffix = Path(filename).suffix
    path = folder / f"{now_stamp()}_{stem}{suffix}"
    path.write_bytes(content)
    return path


def _save_blob_exact(folder: Path, filename: str, content: bytes) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    safe_name = sanitize_filename(filename or "file", "file")
    stem = sanitize_filename(Path(safe_name).stem, "file")
    suffix = Path(safe_name).suffix or ".bin"
    path = folder / f"{stem}{suffix}"
    if path.exists():
        path = folder / f"{stem}_{uuid.uuid4().hex[:6]}{suffix}"
    path.write_bytes(content)
    return path


def _kb_items() -> list[dict[str, Any]]:
    return sorted(_load_manifest("kb_documents").get("items", []), key=lambda x: x.get("added_at", ""), reverse=True)


def _kb_find(filename: str) -> dict[str, Any] | None:
    target = (filename or "").strip().lower()
    for item in _kb_items():
        if str(item.get("filename", "")).lower() == target:
            return item
    return None


def _kb_add(*, stored_path: Path, text_content: str, tags: list[str]) -> dict[str, Any]:
    doc_id = uuid.uuid4().hex[:12]
    text_path = KB_DIR / "texts" / f"{stored_path.stem}_{doc_id}.txt"
    text_path.write_text(text_content or "", encoding="utf-8")
    item = {
        "id": doc_id,
        "filename": stored_path.name,
        "stored_path": str(stored_path.relative_to(DATA_ROOT)).replace("\\", "/"),
        "text_path": str(text_path.relative_to(DATA_ROOT)).replace("\\", "/"),
        "tags": tags,
        "added_at": now_iso(),
    }
    _upsert_manifest("kb_documents", item)
    return item


def _build_intake_summary(intake: "PatientIntakeData") -> str:
    lines = [
        "PATIENT INTAKE SUMMARY",
        f"Generated: {datetime.now():%Y-%m-%d %H:%M:%S}",
        "",
        f"Full Name: {intake.FullName}",
        f"DOB: {intake.DateOfBirth}",
        f"Gender: {intake.Gender}",
        f"Address: {intake.Address}",
        f"Phone: {intake.PhoneNumber}",
        f"Email: {intake.Email}",
        f"Emergency Contact: {intake.ContactPerson} ({intake.ContactNumber})",
        "",
        "VITALS",
        f"BP: {intake.BloodPressure}",
        f"HR: {intake.HeartRate}",
        f"RR: {intake.RespiratoryRate}",
        f"Temp: {intake.Temperature}",
        f"SpO2: {intake.SpO2}",
        f"Height: {intake.Height}",
        f"Weight: {intake.Weight}",
        f"BMI: {intake.BMI}",
        "",
        "CHIEF COMPLAINT",
        intake.ChiefComplaint or "-",
        "",
        "HISTORY OF PRESENT ILLNESS",
        f"Onset: {intake.OnsetDate}",
        f"Duration: {intake.Duration}",
        f"Severity: {intake.Severity}",
        f"Location: {intake.Location}",
        f"Associated Symptoms: {intake.AssociatedSymptoms}",
        intake.AdditionalHistoryNotes or "",
        "",
        "MEDICATIONS / SOCIAL / HISTORY",
        f"Medications: {intake.Medications}",
        f"OTC: {intake.OTCMeds}",
        f"Supplements: {intake.Supplements}",
        f"Smoking: {intake.SmokingStatus}",
        f"Alcohol: {intake.AlcoholUse}",
        f"Drug Use: {intake.DrugUse}",
        f"Allergies: {intake.Allergies}",
        f"Family History: {intake.NotableFamilyMedicalHistory}",
        f"Past Medical History: {intake.PastMedicalHistory}",
        f"Immunization History: {intake.ImmunizationHistory}",
        f"Last Clinic Visit: {intake.LastClinicVisitNotes}",
        "",
        "MEDICAL ASSISTANT NOTES",
        intake.MedicalAssistantNotes or "-",
        intake.AdditionalMedicalAssistantNotes or "",
        "",
    ]
    labs = [
        intake.LabExtractedText1,
        intake.LabExtractedText2,
        intake.LabExtractedText3,
        intake.LabExtractedText4,
        intake.LabExtractedText5,
        intake.LabExtractedText6,
    ]
    for i, text in enumerate(labs, start=1):
        if (text or "").strip():
            lines.extend([f"LAB RESULT {i}", text.strip(), ""])
    return "\n".join(lines).strip()


def _enhance_report(intake: "PatientIntakeData") -> str:
    summary = _build_intake_summary(intake)
    ai = openai_chat(
        [
            {
                "role": "system",
                "content": (
                    "You are a clinical intake documentation assistant. Rewrite the intake into a clean pre-consult note. "
                    "Do not diagnose. Keep all factual details and measurements."
                ),
            },
            {"role": "user", "content": summary},
        ]
    )
    if ai:
        return ai
    return "Structured Intake (fallback; no LLM configured)\n\n" + summary


def _analyze_case(note: str, refs: list[str]) -> str:
    clean = (note or "").strip()
    if not clean:
        return "No clinical note provided."
    refs_line = ", ".join(refs) if refs else "None"
    ai = openai_chat(
        [
            {
                "role": "system",
                "content": (
                    "Provide a structured clinical analysis support note. Include likely concerns, missing information, red flags, "
                    "and suggested follow-up questions/tests. Do not present a definitive diagnosis."
                ),
            },
            {"role": "user", "content": f"Doctor note:\n{clean}\n\nLocal references: {refs_line}"},
        ]
    )
    if ai:
        return ai
    keywords = sorted(list(_tokens(clean)))[:12]
    kw_lines = "\n".join(f"- {k}" for k in keywords) if keywords else "- (none)"
    return textwrap.dedent(
        f"""
        Clinical Analysis (fallback; no LLM configured)

        This is not a diagnosis and cannot replace a licensed clinician.

        Key extracted terms:
        {kw_lines}

        Red flags to confirm/triage:
        - Severe chest pain or shortness of breath
        - Altered mental status or focal neurologic deficits
        - Hemodynamic instability or uncontrolled bleeding
        - Rapid worsening symptoms

        Missing information to clarify:
        - Onset/timeline, severity scale, ROS, PMH, medications, allergies, recent vitals/labs
        - Relevant local references considered: {refs_line}
        """
    ).strip()


def _draft_medical_certificate_from_doctor_context(
    req: "MedicalCertificateAiFromDoctorRequest",
    *,
    patient_name: str,
    patient_dob: str,
) -> dict[str, Any]:
    issue_date = (req.issue_date or "").strip() or datetime.now().strftime("%Y-%m-%d")
    note = (req.doctor_note or "").strip()
    analysis = (req.analysis or "").strip()
    reason = (req.appointment_reason or "").strip()
    notes = (req.appointment_notes or "").strip()

    context = textwrap.dedent(
        f"""
        Patient Name: {patient_name}
        Patient DOB: {patient_dob}
        Issue Date: {issue_date}
        Appointment Reason: {reason}
        Appointment Notes: {notes}

        Doctor Note:
        {note}

        AI Analysis:
        {analysis}
        """
    ).strip()

    ai_raw = openai_chat(
        [
            {
                "role": "system",
                "content": (
                    "You draft medical-certificate content for a doctor. "
                    "Return strict JSON only with keys: diagnosis, recommendations, rest_days, valid_until, additional_notes. "
                    "rest_days must be integer 0-365. valid_until must be YYYY-MM-DD or empty string."
                ),
            },
            {
                "role": "user",
                "content": f"Create certificate draft from this context:\n\n{context}",
            },
        ]
    )
    parsed = _json_object_from_text(ai_raw or "")

    diagnosis = str(parsed.get("diagnosis") or "").strip()
    if not diagnosis:
        diagnosis = reason or "Clinical symptoms requiring short medical rest and follow-up."

    recommendations = str(parsed.get("recommendations") or "").strip()
    if not recommendations:
        recommendations = "Advise rest, hydration, medications as prescribed, and follow-up as needed."

    rest_days = _safe_int(parsed.get("rest_days"), 1, min_value=0, max_value=365)

    valid_until = str(parsed.get("valid_until") or "").strip()
    if not valid_until and rest_days > 0:
        try:
            issue_dt = datetime.strptime(issue_date, "%Y-%m-%d")
            valid_until = (issue_dt + timedelta(days=rest_days)).strftime("%Y-%m-%d")
        except Exception:
            valid_until = ""

    additional_notes = str(parsed.get("additional_notes") or "").strip()
    if not additional_notes:
        snippets = [x for x in [notes, analysis[:700], note[:700]] if (x or "").strip()]
        additional_notes = "\n\n".join(snippets).strip()

    return {
        "diagnosis": diagnosis,
        "recommendations": recommendations,
        "rest_days": rest_days,
        "valid_until": valid_until,
        "additional_notes": additional_notes,
        "issue_date": issue_date,
        "ai_used": bool(ai_raw),
    }


def _create_intake_record(intake: "PatientIntakeData", enhanced_report: str) -> dict[str, Any]:
    record_id = uuid.uuid4().hex[:12]
    prefix = _patient_file_prefix(
        intake.FullName,
        intake.DateOfBirth,
        fallback_name="Unknown Patient",
        fallback_dob="Unknown DOB",
    )
    folder = INTAKES_DIR / f"{prefix}_INTAKE_{record_id}"
    folder.mkdir(parents=True, exist_ok=True)
    summary = _build_intake_summary(intake)
    (folder / "intake.json").write_text(intake.model_dump_json(indent=2), encoding="utf-8")
    (folder / "summary.txt").write_text(summary, encoding="utf-8")
    (folder / "enhanced_report.txt").write_text(enhanced_report or "", encoding="utf-8")
    item = {
        "id": record_id,
        "full_name": intake.FullName,
        "date_of_birth": intake.DateOfBirth,
        "chief_complaint": intake.ChiefComplaint,
        "created_at": now_iso(),
        "folder": str(folder.relative_to(DATA_ROOT)).replace("\\", "/"),
    }
    _upsert_manifest("intakes", item)
    return item


def _list_intakes() -> list[dict[str, Any]]:
    return sorted(_load_manifest("intakes").get("items", []), key=lambda x: x.get("created_at", ""), reverse=True)


def _get_intake(record_id: str) -> dict[str, Any] | None:
    for item in _load_manifest("intakes").get("items", []):
        if item.get("id") != record_id:
            continue
        folder = DATA_ROOT / str(item["folder"])
        return {
            "meta": item,
            "intake": json.loads((folder / "intake.json").read_text(encoding="utf-8")),
            "intake_summary": (folder / "summary.txt").read_text(encoding="utf-8") if (folder / "summary.txt").exists() else "",
            "enhanced_report": (folder / "enhanced_report.txt").read_text(encoding="utf-8") if (folder / "enhanced_report.txt").exists() else "",
        }
    return None


def _create_patient_record(note: str, title: str | None = None) -> dict[str, Any]:
    clean = (note or "").strip()
    if not clean:
        raise ValueError("Doctor note is empty.")
    first_line = (title or clean.splitlines()[0][:120]).strip() or "patient_record"
    record_id = uuid.uuid4().hex[:12]
    full_name = _extract_labeled_value(clean, ["Full Name:", "Patient Name:"])
    dob = _extract_labeled_value(clean, ["Date of Birth:", "DOB:"])
    prefix = _patient_file_prefix(
        full_name,
        dob,
        fallback_name=first_line or "patient_record",
        fallback_dob="Unknown DOB",
    )
    file_path = PATIENT_RECORDS_DIR / f"{prefix}_DPR_{record_id}.txt"
    file_path.write_text(clean, encoding="utf-8")
    item = {
        "id": record_id,
        "title": first_line,
        "filename": file_path.name,
        "created_at": now_iso(),
        "path": str(file_path.relative_to(DATA_ROOT)).replace("\\", "/"),
    }
    _upsert_manifest("patient_records", item)
    _kb_add(stored_path=file_path, text_content=clean, tags=["patient-record"])
    return item


def _list_patient_records() -> list[dict[str, Any]]:
    return sorted(_load_manifest("patient_records").get("items", []), key=lambda x: x.get("created_at", ""), reverse=True)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    history: list[ChatMessage] = Field(default_factory=list)


PortalRole = Literal["doctor", "assistant"]


class AuthLoginRequest(BaseModel):
    role: PortalRole
    pin: str = ""


class PatientIntakeData(BaseModel):
    FullName: str = ""
    DateOfBirth: str = ""
    Gender: str = ""
    Address: str = ""
    PhoneNumber: str = ""
    Email: str = ""
    ContactPerson: str = ""
    ContactNumber: str = ""
    BloodPressure: str = ""
    HeartRate: str = ""
    RespiratoryRate: str = ""
    Temperature: str = ""
    SpO2: str = ""
    Height: str = ""
    Weight: str = ""
    BMI: str = ""
    ChiefComplaint: str = ""
    OnsetDate: str = ""
    Duration: str = ""
    Severity: str = ""
    Location: str = ""
    AssociatedSymptoms: str = ""
    Medications: str = ""
    OTCMeds: str = ""
    Supplements: str = ""
    SmokingStatus: str = ""
    AlcoholUse: str = ""
    DrugUse: str = ""
    Allergies: str = ""
    NotableFamilyMedicalHistory: str = ""
    PastMedicalHistory: str = ""
    ImmunizationHistory: str = ""
    LastClinicVisitNotes: str = ""
    MedicalAssistantNotes: str = ""
    AdditionalDemographicsNotes: str = ""
    AdditionalVitalNotes: str = ""
    AdditionalHistoryNotes: str = ""
    AdditionalMedicationNotes: str = ""
    AdditionalSocialNotes: str = ""
    AdditionalAllergyNotes: str = ""
    AdditionalFamilyHistoryNotes: str = ""
    AdditionalPastMedicalNotes: str = ""
    AdditionalImmunizationNotes: str = ""
    AdditionalLastClinicVisitNotes: str = ""
    AdditionalMedicalAssistantNotes: str = ""
    LabExtractedText1: str = ""
    LabExtractedText2: str = ""
    LabExtractedText3: str = ""
    LabExtractedText4: str = ""
    LabExtractedText5: str = ""
    LabExtractedText6: str = ""


class IntakeCreateRequest(BaseModel):
    intake: PatientIntakeData
    generate_enhanced_report: bool = True


class AnalyzeCaseRequest(BaseModel):
    note: str = ""
    reference_names: list[str] = Field(default_factory=list)


class AskPdfRequest(BaseModel):
    filename: str
    history: list[ChatMessage] = Field(default_factory=list)


class MedicalReferencesRequest(BaseModel):
    query: str
    max_pubmed: int = 6
    max_trials: int = 5
    max_rxnorm: int = 15
    summarize: bool = True
    max_summary_paragraphs: int = 3


class PatientRecordCreateRequest(BaseModel):
    note: str
    title: str | None = None


class IntakePdfCreateRequest(BaseModel):
    intake: PatientIntakeData
    enhanced_report: str = ""
    title: str = ""


class PatientRecordPdfCreateRequest(BaseModel):
    note: str
    title: str = ""
    patient_name: str = ""
    patient_dob: str = ""
    source_role: Literal["doctor", "assistant"] = "doctor"


class MedicalCertificatePdfCreateRequest(BaseModel):
    patient_name: str
    patient_dob: str = ""
    patient_address: str = ""
    patient_gender: str = ""
    patient_age: str = ""
    patient_age_gender: str = ""
    diagnosis: str = ""
    recommendations: str = ""
    rest_days: int | None = Field(default=None, ge=0, le=365)
    issue_date: str = ""
    valid_until: str = ""
    doctor_name: str = ""
    doctor_license: str = ""
    clinic_name: str = ""
    additional_notes: str = ""
    requested_for: str = ""
    use_doctor_template: bool = False
    certificate_title: str = "Medical Certificate"


class MedicalCertificateAiFromDoctorRequest(BaseModel):
    patient_name: str = ""
    patient_dob: str = ""
    patient_address: str = ""
    patient_gender: str = ""
    patient_age: str = ""
    patient_age_gender: str = ""
    doctor_note: str = ""
    analysis: str = ""
    appointment_reason: str = ""
    appointment_notes: str = ""
    doctor_name: str = ""
    doctor_license: str = ""
    clinic_name: str = ""
    issue_date: str = ""
    requested_for: str = ""
    use_doctor_template: bool = False
    certificate_title: str = "Medical Certificate"


AppointmentStatus = Literal["scheduled", "checked_in", "completed", "cancelled", "no_show"]


class AvailabilityWindow(BaseModel):
    # 0 = Monday ... 6 = Sunday (Python datetime.weekday)
    weekday: int = Field(ge=0, le=6)
    start: str = "09:00"  # HH:MM (24h)
    end: str = "17:00"  # HH:MM (24h)


class AvailabilityConfig(BaseModel):
    windows: list[AvailabilityWindow] = Field(default_factory=list)
    slot_minutes: int = Field(default=15, ge=5, le=240)


class Appointment(BaseModel):
    id: str
    patient_name: str
    patient_email: str = ""
    patient_phone: str = ""
    reason: str = ""
    start_time: str  # ISO 8601
    end_time: str  # ISO 8601
    status: AppointmentStatus = "scheduled"
    notes: str = ""
    created_at: str
    updated_at: str
    reminder_sent_at: str = ""


class AppointmentCreateRequest(BaseModel):
    patient_name: str
    patient_email: str = ""
    patient_phone: str = ""
    reason: str = ""
    start_time: str
    duration_minutes: int = Field(default=30, ge=5, le=480)
    notes: str = ""
    allow_waitlist: bool = False


class AppointmentUpdateRequest(BaseModel):
    patient_name: str | None = None
    patient_email: str | None = None
    patient_phone: str | None = None
    reason: str | None = None
    start_time: str | None = None
    duration_minutes: int | None = Field(default=None, ge=5, le=480)
    status: AppointmentStatus | None = None
    notes: str | None = None


class WaitlistItem(BaseModel):
    id: str
    patient_name: str
    patient_email: str = ""
    patient_phone: str = ""
    reason: str = ""
    preferred_start_time: str = ""
    duration_minutes: int = 30
    notes: str = ""
    created_at: str
    status: Literal["waiting", "contacted", "converted", "cancelled"] = "waiting"


class WaitlistCreateRequest(BaseModel):
    patient_name: str
    patient_email: str = ""
    patient_phone: str = ""
    reason: str = ""
    preferred_start_time: str = ""
    duration_minutes: int = Field(default=30, ge=5, le=480)
    notes: str = ""


def _default_availability() -> AvailabilityConfig:
    return AvailabilityConfig(
        windows=[
            AvailabilityWindow(weekday=0, start="09:00", end="17:00"),
            AvailabilityWindow(weekday=1, start="09:00", end="17:00"),
            AvailabilityWindow(weekday=2, start="09:00", end="17:00"),
            AvailabilityWindow(weekday=3, start="09:00", end="17:00"),
            AvailabilityWindow(weekday=4, start="09:00", end="17:00"),
        ],
        slot_minutes=15,
    )


def _load_availability() -> AvailabilityConfig:
    raw = _load_manifest("availability")
    try:
        cfg = AvailabilityConfig(**(raw or {}))
        if not cfg.windows:
            return _default_availability()
        return cfg
    except Exception:
        return _default_availability()


def _save_availability(cfg: AvailabilityConfig) -> None:
    _save_manifest("availability", cfg.model_dump())


def _appointments_manifest_items() -> list[dict[str, Any]]:
    return list(_load_manifest("appointments").get("items", []) or [])


def _waitlist_manifest_items() -> list[dict[str, Any]]:
    return list(_load_manifest("waitlist").get("items", []) or [])


def _parse_hhmm(value: str) -> tuple[int, int]:
    s = (value or "").strip()
    parts = s.split(":")
    if len(parts) != 2:
        raise ValueError("Time must be HH:MM")
    hh = int(parts[0])
    mm = int(parts[1])
    if hh < 0 or hh > 23 or mm < 0 or mm > 59:
        raise ValueError("Time must be HH:MM")
    return hh, mm


def _is_within_availability(start_utc: datetime, end_utc: datetime) -> bool:
    cfg = _load_availability()
    local_tz = _local_tzinfo()
    start_local = start_utc.astimezone(local_tz)
    end_local = end_utc.astimezone(local_tz)
    if start_local.date() != end_local.date():
        return False
    weekday = start_local.weekday()
    sh, sm = start_local.hour, start_local.minute
    eh, em = end_local.hour, end_local.minute
    start_minutes = sh * 60 + sm
    end_minutes = eh * 60 + em
    for w in cfg.windows:
        if int(w.weekday) != int(weekday):
            continue
        wh1, wm1 = _parse_hhmm(w.start)
        wh2, wm2 = _parse_hhmm(w.end)
        window_start = wh1 * 60 + wm1
        window_end = wh2 * 60 + wm2
        if start_minutes >= window_start and end_minutes <= window_end:
            return True
    return False


def _active_appointment_items() -> list[dict[str, Any]]:
    items = _appointments_manifest_items()
    out = []
    for x in items:
        if (x.get("status") or "scheduled") == "cancelled":
            continue
        out.append(x)
    return out


def _find_appointment(appointment_id: str) -> dict[str, Any] | None:
    for x in _appointments_manifest_items():
        if x.get("id") == appointment_id:
            return x
    return None


def _find_waitlist(waitlist_id: str) -> dict[str, Any] | None:
    for x in _waitlist_manifest_items():
        if x.get("id") == waitlist_id:
            return x
    return None


def _appointment_conflicts(start_utc: datetime, end_utc: datetime, exclude_id: str | None = None) -> list[dict[str, Any]]:
    conflicts: list[dict[str, Any]] = []
    for x in _active_appointment_items():
        if exclude_id and x.get("id") == exclude_id:
            continue
        try:
            xs = parse_iso_dt(str(x.get("start_time") or ""))
            xe = parse_iso_dt(str(x.get("end_time") or ""))
        except Exception:
            continue
        if overlaps(start_utc, end_utc, xs, xe):
            conflicts.append(x)
    return conflicts


def _create_waitlist_item(req: WaitlistCreateRequest) -> dict[str, Any]:
    wid = uuid.uuid4().hex[:12]
    item = WaitlistItem(
        id=wid,
        patient_name=req.patient_name.strip(),
        patient_email=(req.patient_email or "").strip(),
        patient_phone=(req.patient_phone or "").strip(),
        reason=(req.reason or "").strip(),
        preferred_start_time=(req.preferred_start_time or "").strip(),
        duration_minutes=int(req.duration_minutes or 30),
        notes=(req.notes or "").strip(),
        created_at=now_iso(),
        status="waiting",
    ).model_dump()
    _upsert_manifest("waitlist", item)
    return item


def _smtp_is_configured() -> bool:
    return bool(os.getenv("SMTP_HOST", "").strip()) and bool(os.getenv("SMTP_FROM", "").strip())


def _send_email(to_email: str, subject: str, body: str) -> None:
    host = os.getenv("SMTP_HOST", "").strip()
    port = int(os.getenv("SMTP_PORT", "587").strip() or "587")
    user = os.getenv("SMTP_USER", "").strip()
    password = os.getenv("SMTP_PASS", "").strip()
    use_tls = (os.getenv("SMTP_TLS", "1").strip() or "1") not in ("0", "false", "False")
    sender = os.getenv("SMTP_FROM", "").strip()

    if not host or not sender:
        raise RuntimeError("SMTP is not configured (set SMTP_HOST and SMTP_FROM)")

    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body or "")

    with smtplib.SMTP(host, port, timeout=20) as smtp:
        smtp.ehlo()
        if use_tls:
            smtp.starttls()
            smtp.ehlo()
        if user:
            smtp.login(user, password)
        smtp.send_message(msg)


def _cors_origins() -> list[str]:
    defaults = {
        FRONTEND_ORIGIN,
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    }
    extra_raw = os.getenv("CORS_ORIGINS", "").strip()
    if extra_raw:
        defaults.update({x.strip() for x in extra_raw.split(",") if x.strip()})
    return sorted(defaults)


def _auth_sign(raw: str) -> str:
    return hmac.new(AUTH_SECRET.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()


def _auth_cookie_token(role: PortalRole) -> str:
    exp = int(time.time()) + AUTH_TTL_SECONDS
    payload = f"{role}|{exp}"
    return f"{payload}|{_auth_sign(payload)}"


def _auth_role_from_token(token: str) -> PortalRole | None:
    parts = (token or "").split("|")
    if len(parts) != 3:
        return None
    role_raw, exp_raw, sig = parts
    role = role_raw.strip().lower()
    if role not in ("doctor", "assistant"):
        return None
    payload = f"{role}|{exp_raw}"
    expected = _auth_sign(payload)
    if not hmac.compare_digest(expected, sig):
        return None
    try:
        exp = int(exp_raw)
    except Exception:
        return None
    if exp <= int(time.time()):
        return None
    return "doctor" if role == "doctor" else "assistant"


def _session_role(request: Request) -> PortalRole | None:
    token = (request.cookies.get(AUTH_COOKIE_NAME) or "").strip()
    if not token:
        return None
    return _auth_role_from_token(token)


def _set_auth_cookie(response: Response, role: PortalRole) -> None:
    kwargs: dict[str, Any] = {}
    if AUTH_COOKIE_PERSIST:
        kwargs["max_age"] = AUTH_TTL_SECONDS

    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=_auth_cookie_token(role),
        httponly=True,
        secure=AUTH_COOKIE_SECURE,
        samesite="lax",
        path="/",
        **kwargs,
    )


def _clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(key=AUTH_COOKIE_NAME, path="/")


def _path_matches(path: str, patterns: tuple[str, ...]) -> bool:
    for p in patterns:
        if path == p or path.startswith(f"{p}/"):
            return True
    return False


_PROTECTED_PATHS: tuple[str, ...] = (
    "/chat",
    "/enhance-patient-report",
    "/intakes",
    "/analyze_case",
    "/list_references",
    "/ask_pdf",
    "/upload_pdf",
    "/attachments/extract",
    "/train_ai",
    "/patient_records",
    "/documents",
    "/availability",
    "/appointments",
    "/waitlist",
    "/rxnav_lookup",
    "/medical_references",
    "/storage",
)

_DOCTOR_ONLY_PATHS: tuple[str, ...] = (
    "/analyze_case",
    "/list_references",
    "/ask_pdf",
    "/upload_pdf",
    "/train_ai",
    "/patient_records",
    "/documents/pdfs",
    "/documents/patient_record_pdf",
    "/documents/medical_certificate_pdf_ai",
    "/rxnav_lookup",
    "/medical_references",
)


app = FastAPI(title="CoPilot Symptomatologist Backend", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/storage", StaticFiles(directory=str(DATA_ROOT)), name="storage")


def _find_static_web_dir() -> Path | None:
    env_dir = os.getenv("STATIC_WEB_DIR", "").strip()
    candidates = [Path(env_dir)] if env_dir else []
    candidates.extend(
        [
            BASE_DIR / "web",
            (BASE_DIR / ".." / "frontend" / "out").resolve(),
        ]
    )
    for d in candidates:
        try:
            if d and d.exists() and (d / "index.html").exists():
                return d
        except Exception:
            continue
    return None


async def _pubmed_search(query: str, limit: int) -> list[dict[str, str]]:
    if not query.strip():
        return []
    async with httpx.AsyncClient(timeout=30) as client:
        search = await client.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
            params={
                "db": "pubmed",
                "retmode": "json",
                "retmax": max(1, min(limit, 20)),
                "sort": "relevance",
                "term": query,
                "tool": "copilot_symptomatologist_web",
            },
        )
        search.raise_for_status()
        ids = (((search.json() or {}).get("esearchresult") or {}).get("idlist")) or []
        if not ids:
            return []
        summary = await client.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
            params={"db": "pubmed", "retmode": "json", "id": ",".join(ids), "tool": "copilot_symptomatologist_web"},
        )
        summary.raise_for_status()
        result = (summary.json() or {}).get("result") or {}
    out: list[dict[str, str]] = []
    for pmid in ids:
        rec = result.get(pmid) or {}
        out.append(
            {
                "pmid": str(pmid),
                "title": str(rec.get("title") or "").strip(),
                "source": str(rec.get("fulljournalname") or rec.get("source") or "").strip(),
                "pubdate": str(rec.get("pubdate") or "").strip(),
                "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
            }
        )
    return out


async def _clinical_trials_search(query: str, limit: int) -> list[dict[str, str]]:
    if not query.strip():
        return []
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                "https://clinicaltrials.gov/api/v2/studies",
                params={"query.term": query, "pageSize": max(1, min(limit, 20)), "format": "json"},
            )
            resp.raise_for_status()
            studies = (resp.json() or {}).get("studies") or []
    except Exception:
        return []
    out: list[dict[str, str]] = []
    for s in studies[:limit]:
        proto = (s or {}).get("protocolSection") or {}
        ident = proto.get("identificationModule") or {}
        status = proto.get("statusModule") or {}
        nct_id = str(ident.get("nctId") or "").strip()
        out.append(
            {
                "nct_id": nct_id,
                "title": str(ident.get("briefTitle") or "").strip(),
                "status": str(status.get("overallStatus") or "").strip(),
                "url": f"https://clinicaltrials.gov/study/{nct_id}" if nct_id else "",
            }
        )
    return out


async def _rxnav_lookup(query: str, limit: int) -> list[str]:
    if not query.strip():
        return []
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get("https://rxnav.nlm.nih.gov/REST/drugs.json", params={"name": query})
            resp.raise_for_status()
            root = resp.json() or {}
    except Exception:
        return []
    names: set[str] = set()
    groups = ((root.get("drugGroup") or {}).get("conceptGroup")) or []
    for g in groups:
        for p in (g or {}).get("conceptProperties") or []:
            n = str((p or {}).get("name") or "").strip()
            if n:
                names.add(n)
    return sorted(names)[: max(1, min(limit, 50))]


def _medical_references_report(query: str, pubmed: list[dict[str, str]], trials: list[dict[str, str]], rxnorm: list[str]) -> str:
    lines = ["MEDICAL REFERENCES REPORT", "", f"Query: {query}", ""]
    lines.append("PUBMED")
    if pubmed:
        for i, x in enumerate(pubmed, 1):
            lines.append(f"{i}. {x.get('title') or '(untitled)'}")
            meta = " | ".join([v for v in [x.get("source", ""), x.get("pubdate", ""), x.get("pmid", "")] if v])
            if meta:
                lines.append(f"   {meta}")
            if x.get("url"):
                lines.append(f"   {x['url']}")
    else:
        lines.append("No PubMed items found.")
    lines.append("")
    lines.append("CLINICALTRIALS.GOV")
    if trials:
        for i, x in enumerate(trials, 1):
            lines.append(f"{i}. {x.get('title') or '(untitled)'}")
            meta = " | ".join([v for v in [x.get("nct_id", ""), x.get("status", "")] if v])
            if meta:
                lines.append(f"   {meta}")
            if x.get("url"):
                lines.append(f"   {x['url']}")
    else:
        lines.append("No clinical trial items found (or API unavailable).")
    lines.append("")
    lines.append("RXNAV / RXNORM")
    if rxnorm:
        for x in rxnorm:
            lines.append(f"- {x}")
    else:
        lines.append("No RxNav matches found.")
    return "\n".join(lines).strip()


def _medical_references_summary(query: str, report_text: str, max_paragraphs: int) -> str:
    ai = openai_chat(
        [
            {
                "role": "system",
                "content": (
                    f"Summarize the medical references report in {max(1, min(max_paragraphs, 5))} short paragraphs. "
                    "Be factual, cautious, and mention source categories."
                ),
            },
            {"role": "user", "content": f"Query: {query}\n\n{report_text}"},
        ]
    )
    if ai:
        return ai
    return (
        "Local summary fallback (no LLM configured).\n\n"
        f"References were gathered for '{query}' across PubMed, ClinicalTrials.gov, and RxNav. "
        "Review the report text for article titles, trial IDs, and medication name matches."
    )


@app.middleware("http")
async def _auth_guard(request: Request, call_next):
    path = request.url.path or "/"
    q_fresh = (request.query_params.get("fresh") or "").strip().lower()
    fresh_login_requested = q_fresh in ("1", "true", "yes")
    if request.method.upper() == "OPTIONS":
        return await call_next(request)

    # Logged-in users should not return to PIN login page until they logout.
    if path == "/login" or path.startswith("/login/"):
        if fresh_login_requested:
            resp = await call_next(request)
            _clear_auth_cookie(resp)
            resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            resp.headers["Pragma"] = "no-cache"
            return resp
        role = _session_role(request)
        if role == "doctor":
            return RedirectResponse(url="/doctor/", status_code=303)
        if role == "assistant":
            return RedirectResponse(url="/assistant/", status_code=303)
        return await call_next(request)

    # Block direct access to doctor workspace unless the authenticated session is doctor.
    if path == "/doctor" or path.startswith("/doctor/"):
        role = _session_role(request)
        if role == "doctor":
            return await call_next(request)
        if role == "assistant":
            return RedirectResponse(url="/assistant/?notice=doctor_locked", status_code=303)
        return RedirectResponse(url="/login/?next=doctor", status_code=303)

    # Guard protected API/storage routes.
    if _path_matches(path, _PROTECTED_PATHS):
        role = _session_role(request)
        if role is None:
            return JSONResponse(status_code=401, content={"detail": "Authentication required."})
        if _path_matches(path, _DOCTOR_ONLY_PATHS) and role != "doctor":
            return JSONResponse(
                status_code=403,
                content={"detail": "Doctor access required for this resource."},
            )

    return await call_next(request)


@app.post("/auth/login")
def auth_login(req: AuthLoginRequest, response: Response) -> dict[str, Any]:
    pin = (req.pin or "").strip()
    expected = DOCTOR_PIN if req.role == "doctor" else ASSISTANT_PIN
    if not hmac.compare_digest(pin, expected):
        raise HTTPException(status_code=401, detail="Invalid login credentials.")
    _set_auth_cookie(response, req.role)
    return {"ok": True, "authenticated": True, "role": req.role}


@app.get("/auth/session")
def auth_session(request: Request) -> dict[str, Any]:
    role = _session_role(request)
    return {"authenticated": role is not None, "role": role}


@app.post("/auth/logout")
def auth_logout(response: Response) -> dict[str, bool]:
    _clear_auth_cookie(response)
    return {"ok": True}


@app.get("/api")
def api_root() -> dict[str, Any]:
    return {
        "name": "CoPilot Symptomatologist Backend",
        "version": "2.0.0",
        "llm_configured": bool(OPENAI_CLIENT),
        "openai_api_key_present": bool(OPENAI_API_KEY),
        "openai_import_error": (OPENAI_IMPORT_ERROR or "").strip(),
        "openai_init_error": (OPENAI_INIT_ERROR or "").strip(),
        "openai_version": _openai_version(),
        "frozen": bool(getattr(sys, "frozen", False)),
        "frontend_origin": FRONTEND_ORIGIN,
        "storage_root": str(DATA_ROOT),
    }


@app.get("/api/llm/diagnostics")
def llm_diagnostics() -> dict[str, Any]:
    env_path = BASE_DIR / ".env"
    return {
        "base_dir": str(BASE_DIR),
        "env_path": str(env_path),
        "env_exists": env_path.exists(),
        "host": HOST,
        "port": PORT,
        "openai_api_key_present": bool(OPENAI_API_KEY),
        "openai_api_key_length": len(OPENAI_API_KEY or ""),
        "openai_model": OPENAI_MODEL,
        "openai_available": OpenAI is not None,
        "openai_import_error": (OPENAI_IMPORT_ERROR or "").strip(),
        "openai_init_error": (OPENAI_INIT_ERROR or "").strip(),
        "openai_version": _openai_version(),
        "python": sys.version,
        "frozen": bool(getattr(sys, "frozen", False)),
        "executable": getattr(sys, "executable", ""),
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "time": now_iso()}


@app.post("/chat")
def chat(req: ChatRequest) -> dict[str, str]:
    messages = [{"role": m.role, "content": m.content} for m in req.history if m.content.strip()]
    reply = openai_chat(messages) if messages else None
    return {"reply": reply or fallback_chat(req.history)}


@app.post("/enhance-patient-report")
def enhance_patient_report_route(intake: PatientIntakeData) -> dict[str, str]:
    return {"enhanced_report": _enhance_report(intake)}


@app.post("/intakes")
def create_intake(req: IntakeCreateRequest) -> dict[str, Any]:
    enhanced = _enhance_report(req.intake) if req.generate_enhanced_report else ""
    meta = _create_intake_record(req.intake, enhanced)
    return {"record": meta, "enhanced_report": enhanced}


@app.get("/intakes")
def list_intakes() -> dict[str, Any]:
    return {"items": _list_intakes()}


@app.get("/intakes/{record_id}")
def get_intake(record_id: str) -> dict[str, Any]:
    data = _get_intake(record_id)
    if not data:
        raise HTTPException(status_code=404, detail="Intake record not found.")
    return data


@app.post("/analyze_case")
def analyze_case(req: AnalyzeCaseRequest) -> dict[str, str]:
    return {"analysis": _analyze_case(req.note, req.reference_names)}


@app.get("/list_references")
def list_references() -> dict[str, list[str]]:
    names = [x["filename"] for x in _kb_items() if "patient-record" not in (x.get("tags") or [])]
    return {"files": names}


@app.post("/ask_pdf")
def ask_pdf(req: AskPdfRequest) -> dict[str, str]:
    item = _kb_find(req.filename)
    if not item:
        raise HTTPException(status_code=404, detail="Reference not found.")
    text_path = DATA_ROOT / str(item["text_path"])
    if not text_path.exists():
        raise HTTPException(status_code=404, detail="Indexed text missing.")
    text = text_path.read_text(encoding="utf-8", errors="ignore")
    question = next((m.content for m in reversed(req.history) if m.role.lower() == "user"), "").strip()
    snippets = retrieve_snippets(text, question, limit=3)
    if not snippets:
        return {"answer": "No relevant information found in the indexed document."}
    context = "\n\n---\n\n".join(snippets)
    ai = openai_chat(
        [
            {"role": "system", "content": "Answer using only the provided document excerpts. If missing, say so."},
            {"role": "user", "content": f"Document: {req.filename}\nQuestion: {question or 'Summarize relevance'}\n\nExcerpts:\n{context}"},
        ]
    )
    return {"answer": ai or (context[:3000] + ("..." if len(context) > 3000 else ""))}


@app.post("/upload_pdf")
async def upload_pdf(pdf: UploadFile = File(...)) -> dict[str, Any]:
    filename = sanitize_filename(pdf.filename or "upload.pdf")
    content = await pdf.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty upload.")
    stored = _save_blob(UPLOADS_DIR / "pdfs", filename, content)
    kb_copy = _save_blob(KB_DIR / "docs", filename, content)
    extracted = extract_text_from_upload(content, filename, pdf.content_type)
    _kb_add(stored_path=kb_copy, text_content=extracted, tags=["uploaded-pdf"])
    rel = str(kb_copy.relative_to(DATA_ROOT)).replace("\\", "/")
    return {
        "filename": kb_copy.name,
        "stored_path": f"/storage/{rel}",
        "bytes": len(content),
        "extracted_text_length": len(extracted or ""),
        "upload_copy": str(stored.relative_to(DATA_ROOT)).replace("\\", "/"),
    }


@app.post("/attachments/extract")
async def attachments_extract(
    file: UploadFile = File(...),
    patient_name: str | None = Form(default=None),
    patient_dob: str | None = Form(default=None),
    lab_slot: int | None = Form(default=None),
) -> dict[str, Any]:
    filename = sanitize_filename(file.filename or "attachment")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty upload.")
    slot = int(lab_slot) if lab_slot is not None else None
    if slot is not None and slot < 1:
        slot = 1
    if slot is not None and slot > 6:
        slot = 6

    safe_name = (patient_name or "").strip()
    safe_dob = (patient_dob or "").strip()
    ext = Path(filename).suffix
    if not ext:
        ctype = (file.content_type or "").lower()
        if ctype == "application/pdf":
            ext = ".pdf"
        elif ctype in {"image/jpeg", "image/jpg"}:
            ext = ".jpg"
        elif ctype == "image/png":
            ext = ".png"
        elif ctype == "image/webp":
            ext = ".webp"
        else:
            ext = ".bin"

    if safe_name:
        prefix = _patient_file_prefix(safe_name, safe_dob)
        slot_suffix = f"_LR{slot}" if slot is not None else "_ATTACHMENT"
        target_name = f"{prefix}{slot_suffix}{ext}"
        stored = _save_blob_exact(UPLOADS_DIR / "attachments", target_name, content)
    else:
        stored = _save_blob(UPLOADS_DIR / "attachments", filename, content)

    extracted, ocr_engine, ocr_message = extract_text_with_meta_from_upload(content, filename, file.content_type)
    rel = str(stored.relative_to(DATA_ROOT)).replace("\\", "/")
    msg = ""
    if not extracted:
        if (file.content_type or "").startswith("image/"):
            msg = ocr_message or "OCR attempted but no readable text was detected."
        elif filename.lower().endswith(".pdf") or (file.content_type or "").lower() == "application/pdf":
            msg = ocr_message or "No readable text found in PDF."
    return {
        "filename": stored.name,
        "stored_path": f"/storage/{rel}",
        "content_type": file.content_type,
        "size_bytes": len(content),
        "extracted_text": extracted,
        "message": msg,
        "ocr_engine": ocr_engine,
    }


@app.post("/train_ai/upload")
async def train_ai_upload(file: UploadFile = File(...), tags: str | None = Form(default=None)) -> dict[str, Any]:
    filename = sanitize_filename(file.filename or "training_file")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty upload.")
    stored = _save_blob(KB_DIR / "docs", filename, content)
    extracted = extract_text_from_upload(content, filename, file.content_type)
    item = _kb_add(stored_path=stored, text_content=extracted, tags=parse_tags_csv(tags))
    return {"ok": True, "filename": item["filename"], "tags": item["tags"], "extracted_text_length": len(extracted or "")}


@app.get("/train_ai/status")
def train_ai_status() -> dict[str, Any]:
    docs = [x for x in _kb_items() if "patient-record" not in (x.get("tags") or [])]
    return {"trained_documents": len(docs), "documents": docs}


@app.post("/patient_records")
def create_patient_record(req: PatientRecordCreateRequest) -> dict[str, Any]:
    try:
        item = _create_patient_record(req.note, req.title)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"record": item}


@app.get("/patient_records")
def list_patient_records() -> dict[str, Any]:
    return {"items": _list_patient_records()}


@app.get("/documents/pdfs")
def list_generated_pdfs() -> dict[str, Any]:
    items = sorted(
        _load_manifest("pdf_documents").get("items", []),
        key=lambda x: x.get("created_at", ""),
        reverse=True,
    )
    return {"items": items}


@app.post("/documents/intake_pdf")
def create_intake_pdf(req: IntakePdfCreateRequest) -> dict[str, Any]:
    patient_name = (req.intake.FullName or "").strip() or "Patient"
    title = (req.title or "").strip() or f"Patient Intake Record - {patient_name}"
    sections: list[tuple[str, str]] = [
        ("Intake Summary", _build_intake_summary(req.intake)),
    ]
    enhanced = (req.enhanced_report or "").strip()
    if enhanced:
        sections.append(("Enhanced Intake Report", enhanced))
    try:
        pdf_bytes = _render_pdf_document(title, sections)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to generate intake PDF: {exc}") from exc

    document = _store_generated_pdf(
        filename_stem=f"intake_{patient_name}",
        pdf_bytes=pdf_bytes,
        document_type="intake",
        title=title,
        patient_name=patient_name,
        patient_dob=(req.intake.DateOfBirth or "").strip(),
        naming_suffix="INTAKE",
    )
    return {"ok": True, "document": document}


@app.post("/documents/patient_record_pdf")
def create_patient_record_pdf(req: PatientRecordPdfCreateRequest) -> dict[str, Any]:
    clean_note = (req.note or "").strip()
    if not clean_note:
        raise HTTPException(status_code=400, detail="note is required")

    patient_name = (
        (req.patient_name or "").strip()
        or _extract_labeled_value(clean_note, ["Full Name:", "Patient Name:"])
        or _extract_bracketed_prefix_value(clean_note, "[Assistant intake selected]")
    )
    patient_dob = (
        (req.patient_dob or "").strip()
        or _extract_labeled_value(clean_note, ["Date of Birth:", "DOB:"])
    )
    role = (req.source_role or "doctor").strip() or "doctor"
    title = (req.title or "").strip() or f"Patient Record ({role.title()})"
    sections: list[tuple[str, str]] = []
    if patient_name or patient_dob:
        patient_lines: list[str] = []
        if patient_name:
            patient_lines.append(f"Name: {patient_name}")
        if patient_dob:
            patient_lines.append(f"DOB: {patient_dob}")
        sections.append(("Patient", "\n".join(patient_lines)))
    sections.append(("Clinical Note", clean_note))

    try:
        pdf_bytes = _render_pdf_document(title, sections)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to generate patient record PDF: {exc}") from exc

    document = _store_generated_pdf(
        filename_stem=f"patient_record_{patient_name or role}",
        pdf_bytes=pdf_bytes,
        document_type=f"patient_record_{role}",
        title=title,
        patient_name=patient_name,
        patient_dob=patient_dob,
        naming_suffix="DPR",
    )
    return {"ok": True, "document": document}


def _medical_certificate_template_text(
    req: MedicalCertificatePdfCreateRequest,
    *,
    patient_name: str,
    issue_date: str,
) -> str:
    age_gender = (req.patient_age_gender or "").strip()
    if not age_gender:
        age = (req.patient_age or "").strip()
        gender = (req.patient_gender or "").strip()
        if age and gender:
            age_gender = f"{age} / {gender}"
        else:
            age_gender = age or gender
    if not age_gender:
        age_gender = "male/female"

    address = (req.patient_address or "").strip() or "________________"
    reason = (req.diagnosis or "").strip() or "________________"
    diagnosis = (req.diagnosis or "").strip() or "________________"
    requested_for = (req.requested_for or "").strip() or "clinic documentation"

    remarks_parts = []
    if (req.recommendations or "").strip():
        remarks_parts.append((req.recommendations or "").strip())
    if req.rest_days is not None:
        remarks_parts.append(f"Rest advised: {int(req.rest_days)} day(s).")
    if (req.additional_notes or "").strip():
        remarks_parts.append((req.additional_notes or "").strip())
    remarks = " ".join(remarks_parts).strip() or "________________"

    return "\n".join(
        [
            "RICHELLE JOY DIAMANTE-BAYSON, MD, FPCP, FPRA",
            "Internal Medicine (Adult Diseases Specialist)",
            "Rheumatology, Clinical Immunology & Osteoporosis",
            "",
            "Name: "
            + patient_name
            + "      "
            + "Age/Gender: "
            + (age_gender or "________________"),
            "Address: " + address + "      " + "Date: " + issue_date,
            "",
            "MEDICAL CERTIFICATE",
            "",
            "To whom it may concern,",
            "",
            "This is to certify that "
            + patient_name
            + ", "
            + (req.patient_gender or "male/female")
            + ",",
            "consulted me today, " + issue_date + ",",
            "at my clinic because of " + reason + ".",
            "",
            "Clinical Impression: " + diagnosis,
            "",
            "Remarks: " + remarks,
            "",
            "This certificate is issued upon the request of the patient for",
            requested_for + " only and not intended for medicolegal use.",
            "Thanks.",
            "",
            "Richelle Joy D. Bayson, MD",
            "Lic. No.: 0114277",
            "PTR No.: 9234542",
        ]
    )


@app.post("/documents/medical_certificate_pdf")
def create_medical_certificate_pdf(req: MedicalCertificatePdfCreateRequest) -> dict[str, Any]:
    patient_name = (req.patient_name or "").strip()
    if not patient_name:
        raise HTTPException(status_code=400, detail="patient_name is required")

    issue_date = (req.issue_date or "").strip() or datetime.now().strftime("%Y-%m-%d")
    certificate_title = (req.certificate_title or "").strip() or "Medical Certificate"
    rest_text = ""
    if req.rest_days is not None:
        rest_text = f"Rest advised: {int(req.rest_days)} day(s)"

    intro_lines = [
        f"This certifies that {patient_name} was evaluated by a licensed medical professional.",
        f"Issue date: {issue_date}",
    ]
    if (req.valid_until or "").strip():
        intro_lines.append(f"Valid until: {(req.valid_until or '').strip()}")
    if rest_text:
        intro_lines.append(rest_text)

    details_lines = []
    if (req.diagnosis or "").strip():
        details_lines.append(f"Diagnosis / Impression: {(req.diagnosis or '').strip()}")
    if (req.recommendations or "").strip():
        details_lines.append(f"Recommendations: {(req.recommendations or '').strip()}")
    if (req.additional_notes or "").strip():
        details_lines.append(f"Additional notes: {(req.additional_notes or '').strip()}")

    signer_lines = []
    if (req.doctor_name or "").strip():
        signer_lines.append(f"Doctor: {(req.doctor_name or '').strip()}")
    if (req.doctor_license or "").strip():
        signer_lines.append(f"License: {(req.doctor_license or '').strip()}")
    if (req.clinic_name or "").strip():
        signer_lines.append(f"Clinic: {(req.clinic_name or '').strip()}")

    if req.use_doctor_template:
        template_text = _medical_certificate_template_text(
            req,
            patient_name=patient_name,
            issue_date=issue_date,
        )
        sections: list[tuple[str, str]] = [("Medical Certificate", template_text)]
        if not (req.certificate_title or "").strip():
            certificate_title = "Medical Certificate (Doctor Template)"
    else:
        sections = [
            (
                "Patient",
                "\n".join(
                    [
                        f"Name: {patient_name}",
                        *([f"DOB: {(req.patient_dob or '').strip()}"] if (req.patient_dob or "").strip() else []),
                    ]
                ),
            ),
            ("Certificate", "\n".join(intro_lines)),
        ]
        if details_lines:
            sections.append(("Clinical Details", "\n".join(details_lines)))
        if signer_lines:
            sections.append(("Issuer", "\n".join(signer_lines)))

    try:
        pdf_bytes = _render_pdf_document(certificate_title, sections)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to generate medical certificate PDF: {exc}") from exc

    document = _store_generated_pdf(
        filename_stem=f"medical_certificate_{patient_name}",
        pdf_bytes=pdf_bytes,
        document_type="medical_certificate",
        title=certificate_title,
        patient_name=patient_name,
        patient_dob=(req.patient_dob or "").strip(),
        naming_suffix="MC",
    )
    return {"ok": True, "document": document}


@app.post("/documents/medical_certificate_pdf_ai")
def create_medical_certificate_pdf_ai(req: MedicalCertificateAiFromDoctorRequest) -> dict[str, Any]:
    note = (req.doctor_note or "").strip()
    patient_name = (
        (req.patient_name or "").strip()
        or _extract_labeled_value(note, ["Full Name:", "Patient Name:"])
        or _extract_bracketed_prefix_value(note, "[Assistant intake selected]")
    )
    patient_dob = (
        (req.patient_dob or "").strip()
        or _extract_labeled_value(note, ["Date of Birth:", "DOB:"])
    )
    if not patient_name:
        raise HTTPException(status_code=400, detail="patient_name is required (or include in doctor_note)")

    draft = _draft_medical_certificate_from_doctor_context(
        req,
        patient_name=patient_name,
        patient_dob=patient_dob,
    )
    cert_req = MedicalCertificatePdfCreateRequest(
        patient_name=patient_name,
        patient_dob=patient_dob,
        patient_address=(req.patient_address or "").strip(),
        patient_gender=(req.patient_gender or "").strip(),
        patient_age=(req.patient_age or "").strip(),
        patient_age_gender=(req.patient_age_gender or "").strip(),
        diagnosis=str(draft.get("diagnosis") or ""),
        recommendations=str(draft.get("recommendations") or ""),
        rest_days=_safe_int(draft.get("rest_days"), 1, min_value=0, max_value=365),
        issue_date=str(draft.get("issue_date") or ""),
        valid_until=str(draft.get("valid_until") or ""),
        doctor_name=(req.doctor_name or "").strip(),
        doctor_license=(req.doctor_license or "").strip(),
        clinic_name=(req.clinic_name or "").strip(),
        additional_notes=str(draft.get("additional_notes") or ""),
        requested_for=(req.requested_for or "").strip(),
        use_doctor_template=bool(req.use_doctor_template),
        certificate_title=(req.certificate_title or "").strip() or "Medical Certificate",
    )
    result = create_medical_certificate_pdf(cert_req)
    return {
        **result,
        "ai_used": bool(draft.get("ai_used")),
        "ai_draft": {
            "diagnosis": cert_req.diagnosis,
            "recommendations": cert_req.recommendations,
            "rest_days": cert_req.rest_days,
            "valid_until": cert_req.valid_until,
        },
    }


@app.get("/availability")
def get_availability() -> dict[str, Any]:
    return _load_availability().model_dump()


@app.put("/availability")
def put_availability(cfg: AvailabilityConfig) -> dict[str, Any]:
    _save_availability(cfg)
    return {"ok": True, "availability": cfg.model_dump()}


@app.post("/availability")
def post_availability(cfg: AvailabilityConfig) -> dict[str, Any]:
    return put_availability(cfg)


@app.get("/appointments")
def list_appointments(from_time: str | None = None, to_time: str | None = None, status: str | None = None) -> dict[str, Any]:
    items = _appointments_manifest_items()
    if status:
        items = [x for x in items if str(x.get("status") or "scheduled") == status]
    if from_time:
        try:
            fdt = parse_iso_dt(from_time)
            items = [x for x in items if parse_iso_dt(str(x.get("start_time") or "")) >= fdt]
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid from_time")
    if to_time:
        try:
            tdt = parse_iso_dt(to_time)
            items = [x for x in items if parse_iso_dt(str(x.get("start_time") or "")) <= tdt]
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid to_time")
    items = sorted(items, key=lambda x: x.get("start_time", ""))
    return {"items": items}


@app.post("/appointments")
def create_appointment(req: AppointmentCreateRequest) -> dict[str, Any]:
    name = (req.patient_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="patient_name is required")

    try:
        start_utc = parse_iso_dt(req.start_time)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid start_time")
    end_utc = start_utc + timedelta(minutes=int(req.duration_minutes or 30))

    if not _is_within_availability(start_utc, end_utc):
        raise HTTPException(status_code=400, detail="Requested time is outside configured availability")

    conflicts = _appointment_conflicts(start_utc, end_utc)
    if conflicts:
        if req.allow_waitlist:
            wl = _create_waitlist_item(
                WaitlistCreateRequest(
                    patient_name=name,
                    patient_email=(req.patient_email or "").strip(),
                    patient_phone=(req.patient_phone or "").strip(),
                    reason=(req.reason or "").strip(),
                    preferred_start_time=iso_utc(start_utc),
                    duration_minutes=int(req.duration_minutes or 30),
                    notes=(req.notes or "").strip(),
                )
            )
            return {"ok": False, "waitlisted": True, "waitlist": wl, "conflicts": conflicts}
        raise HTTPException(status_code=409, detail="Appointment conflicts with an existing booking")

    appt_id = uuid.uuid4().hex[:12]
    now = now_iso()
    item = Appointment(
        id=appt_id,
        patient_name=name,
        patient_email=(req.patient_email or "").strip(),
        patient_phone=(req.patient_phone or "").strip(),
        reason=(req.reason or "").strip(),
        start_time=iso_utc(start_utc),
        end_time=iso_utc(end_utc),
        status="scheduled",
        notes=(req.notes or "").strip(),
        created_at=now,
        updated_at=now,
        reminder_sent_at="",
    ).model_dump()
    _upsert_manifest("appointments", item)
    return {"ok": True, "appointment": item}


@app.patch("/appointments/{appointment_id}")
def update_appointment(appointment_id: str, req: AppointmentUpdateRequest) -> dict[str, Any]:
    existing = _find_appointment(appointment_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Appointment not found")

    updated = dict(existing)
    for k in ("patient_name", "patient_email", "patient_phone", "reason", "notes"):
        v = getattr(req, k)
        if v is not None:
            updated[k] = str(v)
    if req.status is not None:
        updated["status"] = req.status

    start_str = req.start_time if req.start_time is not None else str(updated.get("start_time") or "")
    duration = req.duration_minutes
    if duration is None:
        try:
            old_start = parse_iso_dt(str(updated.get("start_time") or ""))
            old_end = parse_iso_dt(str(updated.get("end_time") or ""))
            duration = max(5, int((old_end - old_start).total_seconds() // 60))
        except Exception:
            duration = 30

    try:
        start_utc = parse_iso_dt(start_str)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid start_time")
    end_utc = start_utc + timedelta(minutes=int(duration or 30))

    if not _is_within_availability(start_utc, end_utc) and str(updated.get("status") or "scheduled") != "cancelled":
        raise HTTPException(status_code=400, detail="Requested time is outside configured availability")

    conflicts = _appointment_conflicts(start_utc, end_utc, exclude_id=appointment_id)
    if conflicts and str(updated.get("status") or "scheduled") != "cancelled":
        raise HTTPException(status_code=409, detail="Appointment conflicts with an existing booking")

    updated["start_time"] = iso_utc(start_utc)
    updated["end_time"] = iso_utc(end_utc)
    updated["updated_at"] = now_iso()
    _upsert_manifest("appointments", updated)
    return {"ok": True, "appointment": updated}


@app.get("/waitlist")
def list_waitlist() -> dict[str, Any]:
    items = sorted(_waitlist_manifest_items(), key=lambda x: x.get("created_at", ""), reverse=True)
    return {"items": items}


@app.post("/waitlist")
def create_waitlist(req: WaitlistCreateRequest) -> dict[str, Any]:
    name = (req.patient_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="patient_name is required")
    item = _create_waitlist_item(req)
    return {"ok": True, "waitlist": item}


class WaitlistConvertRequest(BaseModel):
    start_time: str


@app.post("/waitlist/{waitlist_id}/convert")
def convert_waitlist(waitlist_id: str, req: WaitlistConvertRequest) -> dict[str, Any]:
    wl = _find_waitlist(waitlist_id)
    if not wl:
        raise HTTPException(status_code=404, detail="Waitlist item not found")
    if str(wl.get("status") or "waiting") in ("converted", "cancelled"):
        raise HTTPException(status_code=400, detail="Waitlist item is not convertible")

    create_req = AppointmentCreateRequest(
        patient_name=str(wl.get("patient_name") or ""),
        patient_email=str(wl.get("patient_email") or ""),
        patient_phone=str(wl.get("patient_phone") or ""),
        reason=str(wl.get("reason") or ""),
        start_time=req.start_time,
        duration_minutes=int(wl.get("duration_minutes") or 30),
        notes=str(wl.get("notes") or ""),
        allow_waitlist=False,
    )
    appt = create_appointment(create_req)
    wl2 = dict(wl)
    wl2["status"] = "converted"
    _upsert_manifest("waitlist", wl2)
    return {"ok": True, "appointment_result": appt, "waitlist": wl2}


def _appointment_reminder_body(item: dict[str, Any]) -> str:
    return (
        "Doctor Appointment Reminder\n\n"
        f"Patient: {item.get('patient_name','')}\n"
        f"When: {item.get('start_time','')}\n"
        f"Reason: {item.get('reason','')}\n\n"
        "If you need to reschedule, please contact the clinic."
    )


@app.post("/appointments/{appointment_id}/send_reminder")
def send_appointment_reminder(appointment_id: str) -> dict[str, Any]:
    item = _find_appointment(appointment_id)
    if not item:
        raise HTTPException(status_code=404, detail="Appointment not found")
    to_email = str(item.get("patient_email") or "").strip()
    if not to_email:
        raise HTTPException(status_code=400, detail="Appointment has no patient_email")
    if not _smtp_is_configured():
        raise HTTPException(status_code=400, detail="SMTP is not configured (set SMTP_HOST and SMTP_FROM)")
    subject = os.getenv("REMINDER_SUBJECT", "Appointment Reminder").strip() or "Appointment Reminder"
    _send_email(to_email, subject, _appointment_reminder_body(item))
    item2 = dict(item)
    item2["reminder_sent_at"] = now_iso()
    item2["updated_at"] = now_iso()
    _upsert_manifest("appointments", item2)
    return {"ok": True, "appointment": item2}


_REMINDER_THREAD_STARTED = False


def _reminder_loop() -> None:
    minutes_before = int(os.getenv("REMINDER_MINUTES_BEFORE", "1440").strip() or "1440")
    poll_seconds = int(os.getenv("REMINDER_POLL_SECONDS", "60").strip() or "60")
    while True:
        try:
            if not _smtp_is_configured():
                time.sleep(max(10, poll_seconds))
                continue
            now_utc = datetime.now(timezone.utc)
            for item in _appointments_manifest_items():
                if str(item.get("status") or "scheduled") != "scheduled":
                    continue
                if str(item.get("reminder_sent_at") or "").strip():
                    continue
                to_email = str(item.get("patient_email") or "").strip()
                if not to_email:
                    continue
                try:
                    start_utc = parse_iso_dt(str(item.get("start_time") or ""))
                except Exception:
                    continue
                delta_minutes = int((start_utc - now_utc).total_seconds() // 60)
                if delta_minutes < 0:
                    continue
                if delta_minutes <= minutes_before:
                    subject = os.getenv("REMINDER_SUBJECT", "Appointment Reminder").strip() or "Appointment Reminder"
                    _send_email(to_email, subject, _appointment_reminder_body(item))
                    item2 = dict(item)
                    item2["reminder_sent_at"] = now_iso()
                    item2["updated_at"] = now_iso()
                    _upsert_manifest("appointments", item2)
        except Exception:
            pass
        time.sleep(max(10, poll_seconds))


@app.on_event("startup")
def _startup_scheduling() -> None:
    global _REMINDER_THREAD_STARTED
    enabled = (os.getenv("REMINDER_ENABLED", "0").strip() or "0") not in ("0", "false", "False")
    if not enabled:
        return
    if _REMINDER_THREAD_STARTED:
        return
    _REMINDER_THREAD_STARTED = True
    t = threading.Thread(target=_reminder_loop, daemon=True)
    t.start()


@app.get("/rxnav_lookup")
async def rxnav_lookup(query: str) -> dict[str, Any]:
    if not query.strip():
        raise HTTPException(status_code=400, detail="query is required")
    try:
        items = await _rxnav_lookup(query, 25)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"RxNav lookup failed: {exc}") from exc
    return {"query": query, "items": items}


@app.post("/medical_references")
async def medical_references(req: MedicalReferencesRequest) -> dict[str, Any]:
    q = (req.query or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="Query is required.")
    errors: list[str] = []
    try:
        pubmed = await _pubmed_search(q, req.max_pubmed)
    except Exception as exc:
        pubmed = []
        errors.append(f"PubMed lookup failed: {exc}")
    try:
        trials = await _clinical_trials_search(q, req.max_trials)
    except Exception as exc:
        trials = []
        errors.append(f"ClinicalTrials lookup failed: {exc}")
    try:
        rxnorm = await _rxnav_lookup(q, req.max_rxnorm)
    except Exception as exc:
        rxnorm = []
        errors.append(f"RxNav lookup failed: {exc}")
    report_text = _medical_references_report(q, pubmed, trials, rxnorm)
    summary_text = _medical_references_summary(q, report_text, req.max_summary_paragraphs) if req.summarize else ""
    return {
        "query": q,
        "summary_text": summary_text,
        "report_text": report_text,
        "pubmed": pubmed,
        "clinical_trials": trials,
        "rxnorm": rxnorm,
        "errors": errors,
    }


# Serve the static web app (Next.js export) if present.
# This is intentionally added near the end so API routes take precedence.
_STATIC_WEB_DIR = _find_static_web_dir()
if _STATIC_WEB_DIR is not None:
    app.mount("/", StaticFiles(directory=str(_STATIC_WEB_DIR), html=True), name="web")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
