"use client";

import { Panel, SmallMeta } from "@/components/ui";
import { getJson, postJson, postMultipart } from "@/lib/api";
import type {
  Appointment,
} from "@/lib/types";
import {
  emptyIntake,
  type GeneratedPdfDocument,
  type IntakeListItem,
  type PatientIntakeData,
} from "@/lib/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState, useTransition } from "react";
import { ensureFreshLoginState, fetchPortalSession, logoutPortal, type PortalRole } from "@/lib/portal-auth";

type IntakeKey = keyof PatientIntakeData;

const demographicFields: { key: IntakeKey; label: string }[] = [
  { key: "FullName", label: "Full name" },
  { key: "DateOfBirth", label: "Date of birth" },
  { key: "Gender", label: "Gender" },
  { key: "Address", label: "Address" },
  { key: "PhoneNumber", label: "Phone number" },
  { key: "Email", label: "Email" },
  { key: "ContactPerson", label: "Emergency contact person" },
  { key: "ContactNumber", label: "Emergency contact number" },
];

const vitalFields: { key: IntakeKey; label: string }[] = [
  { key: "BloodPressure", label: "Blood pressure" },
  { key: "HeartRate", label: "Heart rate" },
  { key: "RespiratoryRate", label: "Respiratory rate" },
  { key: "Temperature", label: "Temperature" },
  { key: "SpO2", label: "SpO2" },
  { key: "Height", label: "Height" },
  { key: "Weight", label: "Weight" },
  { key: "BMI", label: "BMI" },
];

const hpiFields: { key: IntakeKey; label: string }[] = [
  { key: "ChiefComplaint", label: "Chief complaint" },
  { key: "OnsetDate", label: "Onset date/time" },
  { key: "Duration", label: "Duration" },
  { key: "Severity", label: "Severity" },
  { key: "Location", label: "Location" },
  { key: "AssociatedSymptoms", label: "Associated symptoms" },
];

const medSocialFields: { key: IntakeKey; label: string }[] = [
  { key: "Medications", label: "Prescription meds" },
  { key: "OTCMeds", label: "OTC meds" },
  { key: "Supplements", label: "Supplements" },
  { key: "SmokingStatus", label: "Smoking status" },
  { key: "AlcoholUse", label: "Alcohol use" },
  { key: "DrugUse", label: "Drug use" },
];

const historyFields: { key: IntakeKey; label: string }[] = [
  { key: "Allergies", label: "Allergies" },
  { key: "NotableFamilyMedicalHistory", label: "Family history" },
  { key: "PastMedicalHistory", label: "Past medical history" },
  { key: "ImmunizationHistory", label: "Immunization history" },
  { key: "LastClinicVisitNotes", label: "Last clinic visit notes" },
  { key: "MedicalAssistantNotes", label: "Medical assistant notes" },
];

const additionalNoteFields: { key: IntakeKey; label: string }[] = [
  { key: "AdditionalDemographicsNotes", label: "Additional demographics notes" },
  { key: "AdditionalVitalNotes", label: "Additional vital notes" },
  { key: "AdditionalHistoryNotes", label: "Additional history notes" },
  { key: "AdditionalMedicationNotes", label: "Additional medication notes" },
  { key: "AdditionalSocialNotes", label: "Additional social notes" },
  { key: "AdditionalAllergyNotes", label: "Additional allergy notes" },
  { key: "AdditionalFamilyHistoryNotes", label: "Additional family history notes" },
  { key: "AdditionalPastMedicalNotes", label: "Additional past medical notes" },
  { key: "AdditionalImmunizationNotes", label: "Additional immunization notes" },
  { key: "AdditionalLastClinicVisitNotes", label: "Additional last-clinic notes" },
  { key: "AdditionalMedicalAssistantNotes", label: "Additional MA notes" },
];

const labKeys: IntakeKey[] = [
  "LabExtractedText1",
  "LabExtractedText2",
  "LabExtractedText3",
  "LabExtractedText4",
  "LabExtractedText5",
  "LabExtractedText6",
];

export default function AssistantPage() {
  const router = useRouter();
  const [intake, setIntake] = useState<PatientIntakeData>(emptyIntake);
  const [enhancedReport, setEnhancedReport] = useState("");
  const [recent, setRecent] = useState<IntakeListItem[]>([]);
  const [status, setStatus] = useState("Ready.");
  const [error, setError] = useState("");
  const [isBusy, startBusy] = useTransition();
  const [labUploadBusy, setLabUploadBusy] = useState<number | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [apptDate, setApptDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [apptTime, setApptTime] = useState("09:00");
  const [apptDuration, setApptDuration] = useState(30);
  const [apptReason, setApptReason] = useState("");
  const [apptNotes, setApptNotes] = useState("");
  const [allowWaitlist, setAllowWaitlist] = useState(true);
  const [portalRole, setPortalRoleState] = useState<PortalRole | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [documentViewer, setDocumentViewer] = useState<{ url: string; title: string } | null>(null);
  const documentViewerRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await ensureFreshLoginState();
      if (cancelled) return;
      const role = await fetchPortalSession();
      if (cancelled) return;
      if (!role) {
        router.replace("/login/?next=assistant");
        return;
      }
      setPortalRoleState(role);
      setAccessChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const notice = (new URLSearchParams(window.location.search).get("notice") || "").toLowerCase();
    if (notice === "doctor_locked") {
      setStatus("Doctor workspace is restricted for assistant accounts.");
    }
  }, []);

  const setField = (key: IntakeKey, value: string) =>
    setIntake((prev) => ({ ...prev, [key]: value }));

  const loadRecent = async () => {
    setListBusy(true);
    setError("");
    try {
      const resp = await getJson<{ items: IntakeListItem[] }>("/intakes");
      setRecent(resp.items ?? []);
      setStatus(`Loaded ${resp.items?.length ?? 0} intake record(s).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load records.");
    } finally {
      setListBusy(false);
    }
  };

  const openIntakePdfFromRecord = async (id: string) => {
    setError("");
    setStatus(`Preparing patient PDF for record ${id}...`);
    try {
      const data = await getJson<{
        meta?: IntakeListItem;
        intake: PatientIntakeData;
        enhanced_report?: string;
      }>(`/intakes/${id}`);
      const loadedIntake = { ...emptyIntake, ...(data.intake ?? {}) };
      const loadedEnhanced = data.enhanced_report ?? "";
      setIntake(loadedIntake);
      setEnhancedReport(loadedEnhanced);

      const patientName =
        loadedIntake.FullName.trim() || data.meta?.full_name || "Patient";
      try {
        const resp = await postJson<{ ok: boolean; document: GeneratedPdfDocument }>(
          "/documents/intake_pdf",
          {
            intake: loadedIntake,
            enhanced_report: loadedEnhanced,
            title: `Patient Record - ${patientName}`,
          },
        );
        openStoredPdf(resp.document.stored_path, resp.document.filename || "Patient record PDF");
        setStatus(`Opened patient PDF: ${resp.document.filename}`);
      } catch (e) {
        setStatus("Patient PDF is unavailable in this build. Intake loaded into form.");
        setError("");
        console.warn("intake_pdf generation failed", e);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open patient PDF.");
    }
  };

  const runEnhance = () => {
    setError("");
    setStatus("Generating enhanced intake report...");
    startBusy(async () => {
      try {
        const resp = await postJson<{ enhanced_report: string }>(
          "/enhance-patient-report",
          intake,
        );
        setEnhancedReport(resp.enhanced_report ?? "");
        setStatus("Enhanced report generated.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Enhance failed.");
      }
    });
  };

  const saveIntake = () => {
    setError("");
    setStatus("Saving intake record...");
    startBusy(async () => {
      try {
        const resp = await postJson<{
          record: IntakeListItem;
          enhanced_report: string;
        }>("/intakes", { intake, generate_enhanced_report: true });
        setEnhancedReport(resp.enhanced_report ?? enhancedReport);
        setStatus(`Saved intake record ${resp.record?.id ?? ""}.`);
        void loadRecent();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed.");
      }
    });
  };

  const uploadLabFile = async (slot: number, file: File) => {
    setLabUploadBusy(slot);
    setError("");
    setStatus(`Uploading lab file ${slot}...`);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("patient_name", intake.FullName.trim());
      form.append("patient_dob", intake.DateOfBirth.trim());
      form.append("lab_slot", String(slot));
      const resp = await postMultipart<{
        extracted_text: string;
        message?: string;
      }>("/attachments/extract", form);
      const key = labKeys[slot - 1];
      if (key) {
        setField(key, resp.extracted_text || resp.message || "");
      }
      setStatus(
        resp.extracted_text
          ? `Lab file ${slot} uploaded and text extracted.`
          : `Lab file ${slot} uploaded.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lab upload failed.");
    } finally {
      setLabUploadBusy(null);
    }
  };

  const normalizeStoredPath = (path: string) => {
    const clean = (path || "").trim();
    if (!clean) return "";
    if (clean.startsWith("/")) return clean;
    return `/storage/${clean.replace(/^\/+/, "")}`;
  };

  const openStoredPdf = (storedPath: string, title = "Patient document") => {
    if (typeof window === "undefined") return;
    const normalized = normalizeStoredPath(storedPath);
    if (!normalized) return;
    setDocumentViewer({ url: normalized, title });
  };

  const openDocumentInNewTab = () => {
    if (typeof window === "undefined") return;
    if (!documentViewer?.url) return;
    window.open(documentViewer.url, "_blank", "noopener,noreferrer");
  };

  const printActiveDocument = () => {
    if (typeof window === "undefined") return;
    const iframe = documentViewerRef.current;
    try {
      iframe?.contentWindow?.focus();
      iframe?.contentWindow?.print();
      return;
    } catch {
      // Fallback below
    }
    if (documentViewer?.url) {
      window.open(documentViewer.url, "_blank", "noopener,noreferrer");
      setStatus("Opened document in a new tab. Use browser print there.");
    }
  };

  const generatePatientRecordPdf = () => {
    const patientName = intake.FullName.trim();
    if (!patientName) {
      setError("Patient full name is required to generate a patient record PDF.");
      return;
    }
    setError("");
    setStatus("Generating patient record PDF...");
    startBusy(async () => {
      try {
        const resp = await postJson<{ ok: boolean; document: GeneratedPdfDocument }>(
          "/documents/intake_pdf",
          {
            intake,
            enhanced_report: enhancedReport,
            title: `Patient Record - ${patientName}`,
          },
        );
        setStatus(`Patient record PDF ready: ${resp.document.filename}`);
        openStoredPdf(resp.document.stored_path, resp.document.filename || "Patient record PDF");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to generate patient record PDF.");
      }
    });
  };

  const generateMedicalCertificatePdf = () => {
    const patientName = intake.FullName.trim();
    if (!patientName) {
      setError("Patient full name is required to generate a medical certificate.");
      return;
    }
    const diagnosis = window.prompt("Diagnosis / impression", intake.ChiefComplaint || "") ?? "";
    const recommendations =
      window.prompt("Recommendations", "Patient is advised to follow medical advice and rest.") ?? "";
    const restDaysRaw = window.prompt("Rest days (optional integer)", "1");
    const doctorName = window.prompt("Doctor name", "") ?? "";
    const clinicName = window.prompt("Clinic / facility name", "") ?? "";
    const restDays = restDaysRaw && /^\d+$/.test(restDaysRaw.trim()) ? Number(restDaysRaw.trim()) : null;

    setError("");
    setStatus("Generating medical certificate PDF...");
    startBusy(async () => {
      try {
        const resp = await postJson<{ ok: boolean; document: GeneratedPdfDocument }>(
          "/documents/medical_certificate_pdf",
          {
            patient_name: patientName,
            patient_dob: intake.DateOfBirth.trim(),
            diagnosis,
            recommendations,
            rest_days: restDays,
            doctor_name: doctorName,
            clinic_name: clinicName,
            additional_notes: intake.MedicalAssistantNotes || "",
          },
        );
        setStatus(`Medical certificate PDF ready: ${resp.document.filename}`);
        openStoredPdf(resp.document.stored_path, resp.document.filename || "Medical certificate PDF");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to generate medical certificate PDF.");
      }
    });
  };

  const createAppointment = () => {
    const patient_name = intake.FullName.trim();
    if (!patient_name) {
      setError("Full name is required before setting an appointment.");
      return;
    }
    const reason = (apptReason || intake.ChiefComplaint || "").trim();
    const notes = (apptNotes || intake.MedicalAssistantNotes || "").trim();
    const startLocal = new Date(`${apptDate}T${apptTime}`);
    const start_time = startLocal.toISOString();

    setError("");
    setStatus("Creating appointment...");
    startBusy(async () => {
      try {
        const resp = await postJson<{
          ok: boolean;
          appointment?: Appointment;
          waitlisted?: boolean;
        }>("/appointments", {
          patient_name,
          patient_email: intake.Email.trim(),
          patient_phone: intake.PhoneNumber.trim(),
          reason,
          notes,
          start_time,
          duration_minutes: apptDuration,
          allow_waitlist: allowWaitlist,
        });
        if (resp.waitlisted) {
          setStatus("Appointment slot unavailable. Patient added to waitlist.");
        } else {
          setStatus(
            `Appointment set${resp.appointment?.id ? ` (${resp.appointment.id})` : ""}.`,
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create appointment.");
      }
    });
  };

  const handleLogout = () => {
    setError("");
    setStatus("Signing out...");
    startBusy(async () => {
      try {
        await logoutPortal();
      } finally {
        router.replace("/login/?fresh=1");
      }
    });
  };

  if (!accessChecked) {
    return (
      <main className="shell">
        <section className="panel">
          <p className="small-meta">Checking access...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="shell stack" data-testid="assistant-page">
      <section className="hero">
        <h1 className="assistant-hero-title">Medical Assistant Portal</h1>
        <p>
          Front-desk and intake workspace for medical assistants: register
          patient demographics, encode vitals and complaints, upload lab/image
          files for text extraction, generate intake summaries, and forward
          complete records to the doctor for clinical review.
        </p>
        <nav className="hero-nav">
          <Link href="/">Home</Link>
          {portalRole === "doctor" ? (
            <Link href="/doctor">Doctor Workspace</Link>
          ) : (
            <button className="nav-chip-btn" type="button" disabled title="Doctor login required">
              Doctor Workspace (Doctor only)
            </button>
          )}
          <button
            className="nav-chip-btn"
            type="button"
            data-testid="assistant-logout"
            onClick={handleLogout}
            disabled={isBusy}
          >
            Logout
          </button>
          <button
            className="nav-chip-btn"
            data-testid="assistant-refresh-records"
            onClick={() => void loadRecent()}
          >
            {listBusy ? "Refreshing..." : "Refresh recent records"}
          </button>
        </nav>
      </section>

      <div className="page-grid columns-2">
        <Panel title="Patient Demographics" subtitle="Matches legacy intake fields">
          <div className="field-grid">
            {demographicFields.map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={f.key}>{f.label}</label>
                <input
                  id={f.key}
                  data-testid={`assistant-${f.key}`}
                  value={intake[f.key]}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="AdditionalDemographicsNotes">Additional demographics notes</label>
            <textarea
              id="AdditionalDemographicsNotes"
              data-testid="assistant-AdditionalDemographicsNotes"
              value={intake.AdditionalDemographicsNotes}
              onChange={(e) => setField("AdditionalDemographicsNotes", e.target.value)}
            />
          </div>
        </Panel>

        <Panel title="Vitals and Chief Complaint">
          <div className="field-grid compact-3">
            {vitalFields.map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={f.key}>{f.label}</label>
                <input
                  id={f.key}
                  data-testid={`assistant-${f.key}`}
                  value={intake[f.key]}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="AdditionalVitalNotes">Additional vital notes</label>
            <textarea
              id="AdditionalVitalNotes"
              data-testid="assistant-AdditionalVitalNotes"
              value={intake.AdditionalVitalNotes}
              onChange={(e) => setField("AdditionalVitalNotes", e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="ChiefComplaint">Chief complaint</label>
            <textarea
              id="ChiefComplaint"
              data-testid="assistant-ChiefComplaint"
              value={intake.ChiefComplaint}
              onChange={(e) => setField("ChiefComplaint", e.target.value)}
            />
          </div>
        </Panel>

        <Panel title="History, Medications, Social">
          <div className="field-grid">
            {[...hpiFields.filter((f) => f.key !== "ChiefComplaint"), ...medSocialFields].map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={f.key}>{f.label}</label>
                <input
                  id={f.key}
                  data-testid={`assistant-${f.key}`}
                  value={intake[f.key]}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="AdditionalHistoryNotes">Additional history notes</label>
            <textarea
              id="AdditionalHistoryNotes"
              data-testid="assistant-AdditionalHistoryNotes"
              value={intake.AdditionalHistoryNotes}
              onChange={(e) => setField("AdditionalHistoryNotes", e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="AdditionalMedicationNotes">Additional medication notes</label>
            <textarea
              id="AdditionalMedicationNotes"
              data-testid="assistant-AdditionalMedicationNotes"
              value={intake.AdditionalMedicationNotes}
              onChange={(e) => setField("AdditionalMedicationNotes", e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="AdditionalSocialNotes">Additional social notes</label>
            <textarea
              id="AdditionalSocialNotes"
              data-testid="assistant-AdditionalSocialNotes"
              value={intake.AdditionalSocialNotes}
              onChange={(e) => setField("AdditionalSocialNotes", e.target.value)}
            />
          </div>
        </Panel>

        <Panel title="Allergies, Family/Past History, Notes">
          <div className="field-grid">
            {historyFields.map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={f.key}>{f.label}</label>
                <textarea
                  id={f.key}
                  data-testid={`assistant-${f.key}`}
                  value={intake[f.key]}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="field-grid">
            {additionalNoteFields.slice(5).map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={f.key}>{f.label}</label>
                <textarea
                  id={f.key}
                  data-testid={`assistant-${f.key}`}
                  value={intake[f.key]}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="page-grid columns-2">
        <Panel title="Lab Results (1-6)" subtitle="Upload image/PDF or paste extracted text manually">
          <div className="stack">
            {labKeys.map((key, idx) => (
              <div className="panel" key={key} style={{ padding: "0.75rem" }}>
                <div className="toolbar" style={{ justifyContent: "space-between" }}>
                  <strong>Lab Result {idx + 1}</strong>
                  <label className="btn ghost" style={{ cursor: "pointer" }}>
                    {labUploadBusy === idx + 1 ? "Uploading..." : "Upload file"}
                    <input
                      type="file"
                      data-testid={`assistant-lab-upload-${idx + 1}`}
                      accept="image/*,.pdf,application/pdf"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadLabFile(idx + 1, file);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
                <textarea
                  data-testid={`assistant-lab-text-${idx + 1}`}
                  value={intake[key]}
                  onChange={(e) => setField(key, e.target.value)}
                  placeholder={`Lab extracted text ${idx + 1}`}
                />
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Actions and Output">
          <div className="toolbar">
            <button
              className="btn primary"
              data-testid="assistant-save-intake"
              disabled={isBusy}
              onClick={saveIntake}
            >
              {isBusy ? "Working..." : "Save Intake + Generate Report"}
            </button>
            <button
              className="btn accent"
              data-testid="assistant-generate-enhanced"
              disabled={isBusy}
              onClick={runEnhance}
            >
              Generate Enhanced Report Only
            </button>
            <button
              className="btn"
              data-testid="assistant-generate-patient-pdf"
              disabled={isBusy}
              onClick={generatePatientRecordPdf}
            >
              Generate Patient Record PDF
            </button>
            <button
              className="btn"
              data-testid="assistant-generate-certificate-pdf"
              disabled={isBusy}
              onClick={generateMedicalCertificatePdf}
            >
              Generate Medical Certificate PDF
            </button>
            <button
              className="btn"
              data-testid="assistant-clear-form"
              onClick={() => {
                startTransition(() => {
                  setIntake(emptyIntake);
                  setEnhancedReport("");
                  setStatus("Form cleared.");
                  setError("");
                });
              }}
            >
              Clear Form
            </button>
          </div>
          <div className={`status${error ? " error" : ""}`} data-testid="assistant-status">
            {error || status}
          </div>
          <SmallMeta>
            The backend stores intakes under <code>backend/storage/webapp/intakes</code>.
          </SmallMeta>
          <div className="pre" data-testid="assistant-enhanced-report">
            {enhancedReport || "Enhanced report output will appear here."}
          </div>
        </Panel>
      </div>

      <Panel title="Appointment Scheduling" subtitle="Assistant can set patient appointments on host">
        <div className="field-grid">
          <div className="field">
            <label>Patient name (from intake)</label>
            <input
              data-testid="assistant-appt-patient-name"
              value={intake.FullName}
              onChange={(e) => setField("FullName", e.target.value)}
              placeholder="Patient full name"
            />
          </div>
          <div className="field">
            <label>Patient email</label>
            <input
              data-testid="assistant-appt-email"
              value={intake.Email}
              onChange={(e) => setField("Email", e.target.value)}
              placeholder="patient@example.com"
            />
          </div>
          <div className="field">
            <label>Patient phone</label>
            <input
              data-testid="assistant-appt-phone"
              value={intake.PhoneNumber}
              onChange={(e) => setField("PhoneNumber", e.target.value)}
              placeholder="Phone number"
            />
          </div>
          <div className="field">
            <label>Date</label>
            <input
              type="date"
              data-testid="assistant-appt-date"
              value={apptDate}
              onChange={(e) => setApptDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Time</label>
            <input
              type="time"
              data-testid="assistant-appt-time"
              value={apptTime}
              onChange={(e) => setApptTime(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Duration (minutes)</label>
            <select
              data-testid="assistant-appt-duration"
              value={apptDuration}
              onChange={(e) => setApptDuration(Number(e.target.value))}
            >
              {[15, 30, 45, 60].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Reason</label>
            <input
              data-testid="assistant-appt-reason"
              value={apptReason}
              onChange={(e) => setApptReason(e.target.value)}
              placeholder={intake.ChiefComplaint || "Chief complaint / reason"}
            />
          </div>
        </div>
        <div className="field">
          <label>Scheduling notes</label>
          <textarea
            data-testid="assistant-appt-notes"
            value={apptNotes}
            onChange={(e) => setApptNotes(e.target.value)}
            placeholder={intake.MedicalAssistantNotes || "Optional notes"}
          />
        </div>
        <div className="toolbar">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              data-testid="assistant-appt-allow-waitlist"
              checked={allowWaitlist}
              onChange={(e) => setAllowWaitlist(e.target.checked)}
            />
            Add to waitlist if slot is full
          </label>
          <button
            className="btn primary"
            data-testid="assistant-set-appointment"
            disabled={isBusy}
            onClick={createAppointment}
          >
            Set Appointment
          </button>
        </div>
      </Panel>

      <Panel title="Recent Intake Records" subtitle="Load previously saved intake JSON + enhanced report">
        <div className="list" data-testid="assistant-recent-list">
          {recent.length === 0 ? (
            <div className="list-item">
              <SmallMeta>No records loaded yet. Click &quot;Refresh recent records&quot;.</SmallMeta>
            </div>
          ) : (
            recent.map((item) => (
              <div className="list-item" key={item.id} data-testid="assistant-recent-item">
                <strong>{item.full_name || "(Unnamed patient)"}</strong>
                <SmallMeta>
                  DOB: {item.date_of_birth || "-"} | Complaint: {item.chief_complaint || "-"}
                </SmallMeta>
                <SmallMeta>{item.created_at}</SmallMeta>
                <button
                  className="btn"
                  data-testid={`assistant-load-intake-${item.id}`}
                  onClick={() => void openIntakePdfFromRecord(item.id)}
                >
                  Open patient PDF
                </button>
              </div>
            ))
          )}
        </div>
      </Panel>

      <Panel title="Document Viewer + Print" subtitle="Preview generated documents and print from browser">
        {documentViewer ? (
          <div className="stack" style={{ gap: 10 }} data-testid="assistant-document-viewer">
            <SmallMeta>{documentViewer.title}</SmallMeta>
            <div className="toolbar">
              <button
                className="btn primary"
                data-testid="assistant-document-print"
                onClick={printActiveDocument}
              >
                Print
              </button>
              <button
                className="btn"
                data-testid="assistant-document-open-new-tab"
                onClick={openDocumentInNewTab}
              >
                Open in new tab
              </button>
              <button
                className="btn danger"
                data-testid="assistant-document-close-viewer"
                onClick={() => setDocumentViewer(null)}
              >
                Close viewer
              </button>
            </div>
            <iframe
              ref={documentViewerRef}
              src={documentViewer.url}
              title={documentViewer.title}
              style={{
                width: "100%",
                minHeight: 560,
                border: "1px solid rgba(16, 32, 25, 0.14)",
                borderRadius: 12,
                background: "white",
              }}
            />
            <SmallMeta>
              If preview is blocked by browser/PDF plugin, click &quot;Open in new tab&quot; then print there.
            </SmallMeta>
          </div>
        ) : (
          <SmallMeta>Open any patient PDF/certificate to preview and print it here.</SmallMeta>
        )}
      </Panel>
    </main>
  );
}
