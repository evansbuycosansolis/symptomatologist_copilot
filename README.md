# CoPilot Symptomatologist (Web Migration)

This repository has been reworked into a web architecture:

- `frontend/` -> Next.js (App Router) + TypeScript
- `backend/` -> FastAPI

The original WinForms C# project is still kept in the repo as a legacy reference while the new web stack is introduced.

Quick Run (Windows)

Use run-web.ps1 (or run-web.bat) from the repo root:
.\run-web.ps1
Then open http://localhost:3000
One-Time Setup

Backend setup (backend/)
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Create backend env file backend/.env
Copy values from .env.template
Minimum:
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
HOST=127.0.0.1
PORT=8080
FRONTEND_ORIGIN=http://localhost:3000
Frontend setup (frontend/)
cd ..\frontend
npm install
Create frontend env file .env.local
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8080
Manual Run (if script fails)

Terminal 1 (backend):
cd backend
.\.venv\Scripts\Activate.ps1
python -m uvicorn main:app --host 127.0.0.1 --port 8080 --reload
Terminal 2 (frontend):
cd frontend
npm run dev
Notes

run-web.ps1 starts the new web stack.

## What Was Migrated

The new web app covers the core workflows previously spread across the WinForms forms:

- Medical Assistant portal
  - Structured patient intake form (mapped to `PatientIntakeData`)
  - Lab result text slots (1-6)
  - Optional file upload text extraction (`/attachments/extract`)
  - AI-enhanced intake report (`/enhance-patient-report`)
  - Save/load intake records (`/intakes`)

- Medical Doctor workspace
  - Doctor note editor
  - File attachment extraction (PDF/text/image upload handling)
  - AI chat (`/chat`)
  - Case analysis (`/analyze_case`)
  - Save patient records (`/patient_records`)
  - Local knowledge-base training (`/train_ai/upload`, `/train_ai/status`)
  - Ask indexed local reference (`/ask_pdf`)
  - Medical references search (`/medical_references`) using PubMed + ClinicalTrials.gov + RxNav
  - RxNav medication lookup (`/rxnav_lookup`)

## Legacy Compatibility Endpoints Preserved

The FastAPI backend preserves the WinForms contract endpoints used by the desktop app:

- `POST /chat`
- `POST /enhance-patient-report`
- `POST /upload_pdf`
- `GET /list_references`
- `POST /ask_pdf`
- `POST /analyze_case`
- `POST /train_ai/upload`
- `GET /train_ai/status`
- `POST /medical_references`

## Project Structure

```text
.
|-- backend/
|   |-- main.py                # FastAPI app (compat + web endpoints)
|   |-- requirements.txt
|   `-- storage/webapp/        # Runtime data (generated)
|-- frontend/
|   |-- src/app/               # Next.js App Router pages
|   |-- src/lib/               # API client + shared types
|   `-- package.json
|-- run-web.ps1                # Start FastAPI + Next dev server
|-- run-web.bat
`-- .env.template
```

## Quick Start

### 1) Backend

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy ..\.env.template .env.example
```

Create `backend/.env` and set at least:

```env
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
HOST=127.0.0.1
PORT=8080
FRONTEND_ORIGIN=http://localhost:3000
```

Run:

```powershell
python -m uvicorn main:app --host 127.0.0.1 --port 8080 --reload
```

### 2) Frontend

```powershell
cd frontend
npm install
```

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8080
```

Run:

```powershell
npm run dev
```

Open `http://localhost:3000`.

### 3) One-command local launch (Windows)

```powershell
.\run-web.ps1
```

## Notes / Differences from the WinForms App

- Voice dictation (`Vosk`/NAudio) is not ported in this web migration.
- Native WinForms PDF rendering/preview and "Microsoft Print to PDF" workflows are replaced by web-based text/record persistence.
- Image OCR is supported in the backend (`RapidOCR` local OCR, optional Tesseract, optional OpenAI vision fallback).
- If no OCR engine is available or no text is detected, the backend still stores the file and returns a clear message.
- The backend supports local fallback responses when `OPENAI_API_KEY` is missing.

## Validation Performed

- `python -m py_compile backend/main.py`
- `npm run build` (inside `frontend/`)
