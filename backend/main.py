from __future__ import annotations

import io
import json
import os
import re
import textwrap
import uuid
import base64
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

try:
    from openai import OpenAI
except Exception:  # optional runtime dependency
    OpenAI = None  # type: ignore[assignment]

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


def _base_dir() -> Path:
    return Path(__file__).resolve().parent


BASE_DIR = _base_dir()
load_dotenv(BASE_DIR / ".env")

DATA_ROOT = BASE_DIR / "storage" / "webapp"
INTAKES_DIR = DATA_ROOT / "intakes"
PATIENT_RECORDS_DIR = DATA_ROOT / "patient_records"
UPLOADS_DIR = DATA_ROOT / "uploads"
KB_DIR = DATA_ROOT / "kb"
MANIFESTS_DIR = DATA_ROOT / "manifests"
for _p in (
    INTAKES_DIR,
    PATIENT_RECORDS_DIR,
    UPLOADS_DIR / "pdfs",
    UPLOADS_DIR / "attachments",
    KB_DIR / "docs",
    KB_DIR / "texts",
    MANIFESTS_DIR,
):
    _p.mkdir(parents=True, exist_ok=True)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000").strip() or "http://localhost:3000"
HOST = os.getenv("HOST", "127.0.0.1").strip() or "127.0.0.1"
PORT = int(os.getenv("PORT", "8080"))

OPENAI_CLIENT = None
if OPENAI_API_KEY and OpenAI is not None:
    try:
        OPENAI_CLIENT = OpenAI(api_key=OPENAI_API_KEY)
    except Exception:
        OPENAI_CLIENT = None

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


def now_stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def sanitize_filename(name: str, fallback: str = "file") -> str:
    cleaned = re.sub(r"[^\w.\-() ]+", "_", (name or "").strip()).strip(" .")
    return cleaned or fallback


def slugify(text: str, fallback: str = "record") -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (text or "").strip().lower()).strip("_")
    return s or fallback


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
        texts: list[str] = []
        for page in reader.pages[:10]:
            try:
                texts.append((page.extract_text() or "").strip())
            except Exception:
                continue
        return "\n\n".join(t for t in texts if t).strip()
    except Exception:
        return ""


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
        return _extract_pdf_text(content), "pdf-text", None
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
            return (
                "LLM is not configured (missing OPENAI_API_KEY). Local fallback response only.\n\n"
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


def _create_intake_record(intake: "PatientIntakeData", enhanced_report: str) -> dict[str, Any]:
    record_id = uuid.uuid4().hex[:12]
    folder = INTAKES_DIR / f"{now_stamp()}_{slugify(intake.FullName, 'patient')}_{record_id}"
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
    file_path = PATIENT_RECORDS_DIR / f"{now_stamp()}_{slugify(first_line)}_{record_id}.txt"
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


app = FastAPI(title="CoPilot Symptomatologist Backend", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*", FRONTEND_ORIGIN],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/storage", StaticFiles(directory=str(DATA_ROOT)), name="storage")


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


@app.get("/")
def root() -> dict[str, Any]:
    return {
        "name": "CoPilot Symptomatologist Backend",
        "version": "2.0.0",
        "llm_configured": bool(OPENAI_CLIENT),
        "frontend_origin": FRONTEND_ORIGIN,
        "storage_root": str(DATA_ROOT),
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
async def attachments_extract(file: UploadFile = File(...)) -> dict[str, Any]:
    filename = sanitize_filename(file.filename or "attachment")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty upload.")
    stored = _save_blob(UPLOADS_DIR / "attachments", filename, content)
    extracted, ocr_engine, ocr_message = extract_text_with_meta_from_upload(content, filename, file.content_type)
    rel = str(stored.relative_to(DATA_ROOT)).replace("\\", "/")
    msg = ""
    if not extracted and (file.content_type or "").startswith("image/"):
        msg = ocr_message or "OCR attempted but no readable text was detected."
    return {
        "filename": filename,
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=HOST, port=PORT, log_level="info")
