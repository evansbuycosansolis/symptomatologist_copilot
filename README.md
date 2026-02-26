# CoPilot Symptomatologist (Web Migration)

This repository has been reworked into a web architecture:

- `frontend/` -> Next.js (App Router) + TypeScript
- `backend/` -> FastAPI

The original WinForms C# project is still kept in the repo as a legacy reference while the new web stack is introduced.

Quick Run (Windows)

Use run-web.ps1 (or run-web.bat) from the repo root:
.\run-web.ps1
Then open http://localhost:3000

## Run the Web API on another machine (daily use)

If you only need the backend Web API (FastAPI), you do **not** need Node/Next.js on the target machine.

### Option A (recommended): Run from source with Python

1) On the target machine, install Python 3.11+.

2) Copy the repo (or at least the `backend/` folder) to the target machine.

3) Set up the backend venv and install dependencies:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

4) Create `backend/.env` and set at least:

```env
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
HOST=0.0.0.0
PORT=8080
FRONTEND_ORIGIN=http://<YOUR_FRONTEND_HOST>:3000
```

5) Start the API (production-style: no `--reload`):

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python main.py
```

6) Allow inbound traffic to the port (Windows Firewall example):

```powershell
netsh advfirewall firewall add rule name="CoPilot Symptomatologist API" dir=in action=allow protocol=TCP localport=8080
```

7) From another device on the same network, open:

- `http://<SERVER_IP>:8080/health`
- `http://<SERVER_IP>:8080/docs` (interactive API docs)

### Option B: Run it as a background service (Windows)

For daily use, run the backend as a Windows service so it starts on boot and restarts if it crashes.

- Use Task Scheduler (At startup) or a service wrapper like NSSM.
- The command to run is the same as above, e.g. `python main.py` from the `backend/` directory (with the venv activated or by using the venv python).

### Option C (advanced): Standalone EXE (PyInstaller)

There is a PyInstaller spec at `backend/copilot_backend.spec`. If you want a copy-and-run executable for another machine, rebuild it on a machine with all Python dependencies installed.

Note: if you copy an old `backend/dist/` folder between machines, it may fail if it was built without required runtime modules.

## Portable "webapp executable" (copy to another PC)

This repo can be packaged into a **single portable folder** that contains:

- `copilot_backend.exe` (FastAPI)
- a static exported frontend in `web/`
- `start-webapp.bat`

The backend serves the frontend and API from the same port (default `http://127.0.0.1:8080`), so the target PC does **not** need Node.js.

Build the portable bundle (run on your build machine):

```powershell
./package-webapp.ps1
```

It creates: `dist_webapp_portable/`

Daily use on another Windows PC:

1) Copy the entire `dist_webapp_portable/` folder to the other PC
2) Run `start-webapp.bat`
3) The browser opens to `http://127.0.0.1:8080`

To stop it, run `stop-webapp.bat`.

## Two-PC deployment (Doctor host, Assistant client)

Use this topology when all runtime data and `.env` must stay on the Doctor PC.

Build packages:

```powershell
./package-webapp.ps1
```

This creates:

- `dist_symptomatologist_copilot_host/` + `.zip` (Doctor host/server)
- `dist_symptomatologist_copilot_assistant/` + `.zip` (Assistant client launcher only)

Doctor PC (host/server):

1) Extract `dist_symptomatologist_copilot_host`
2) Edit `.env` there (OpenAI key and host settings)
3) Run `Allow Firewall Port 8080 (Run as Admin).bat` once
4) Run `Symptomatologist Copilot (Host).bat`
5) Doctor uses `http://127.0.0.1:8080/doctor/`

Assistant PC (client only):

1) Extract `dist_symptomatologist_copilot_assistant`
2) Run `Set Host IP - Symptomatologist Copilot (Assistant).bat`
3) Run `Symptomatologist Copilot (Assistant).bat` (opens `http://<DOCTOR_HOST_IP>:8080/assistant/`)

With this setup, intake and records are stored only on the Doctor host under `storage/webapp`.

## Scheduling: Appointment reminders (SMTP)

The scheduling system supports email reminders for appointments.

**Required (to send reminders):**

```env
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_FROM=clinic@example.com
```

**Optional (authentication / TLS):**

```env
SMTP_USER=clinic@example.com
SMTP_PASS=your_app_password
SMTP_TLS=1
```

**Manual reminder:**

- The Doctor page button calls `POST /appointments/{id}/send_reminder`.

**Automatic reminders (background thread):**

```env
REMINDER_ENABLED=1
REMINDER_MINUTES_BEFORE=1440
REMINDER_POLL_SECONDS=60
REMINDER_SUBJECT=Appointment Reminder
```

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
  - Generate PDF documents:
    - Intake/patient record PDF (`/documents/intake_pdf`)
    - Medical certificate PDF (`/documents/medical_certificate_pdf`)

- Medical Doctor workspace
  - Doctor note editor
  - File attachment extraction (PDF/text/image upload handling)
  - AI chat (`/chat`)
  - Case analysis (`/analyze_case`)
  - Save patient records (`/patient_records`)
  - Retrieve assistant intakes directly in doctor view (`/intakes`, `/intakes/{id}`)
  - Generate PDF documents:
    - Doctor patient record PDF (`/documents/patient_record_pdf`)
    - Medical certificate PDF (`/documents/medical_certificate_pdf`)
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
