"use client";

import { Panel, SmallMeta } from "@/components/ui";
import { getJson, patchJson, postJson, postMultipart } from "@/lib/api";
import type {
  Appointment,
  AvailabilityConfig,
  ChatMessage,
  GeneratedPdfDocument,
  IntakeListItem,
  KbDocument,
  PatientIntakeData,
  PatientRecordListItem,
  WaitlistItem,
} from "@/lib/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ensureFreshLoginState, fetchPortalSession, logoutPortal } from "@/lib/portal-auth";

const reviseSystemPrompt =
  "You are an expert medical scribe. Rewrite the doctor's note as a formal structured medical report. Keep every fact and measurement. Do not omit or invent information. If uncertain, preserve the original wording.";

type IndexedDocument = {
  id: string;
  document_type: string;
  title: string;
  patient_name: string;
  patient_dob?: string;
  filename: string;
  path: string;
  stored_path: string;
  created_at: string;
  size_bytes?: number;
};

export default function DoctorPage() {
  const router = useRouter();
  const [doctorNote, setDoctorNote] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [status, setStatus] = useState("Ready.");
  const [error, setError] = useState("");
  const [busy, startBusy] = useTransition();
  const [accessChecked, setAccessChecked] = useState(false);

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "CoPilot Symptomatologist web chat is ready. Ask about the current case or request a rewrite/summary.",
    },
  ]);
  const [chatInput, setChatInput] = useState("");

  const [records, setRecords] = useState<PatientRecordListItem[]>([]);
  const [assistantIntakes, setAssistantIntakes] = useState<IntakeListItem[]>([]);
  const [rxQuery, setRxQuery] = useState("");
  const [rxResults, setRxResults] = useState<string[]>([]);

  const [refQuery, setRefQuery] = useState("");
  const [refSummary, setRefSummary] = useState("");
  const [refReport, setRefReport] = useState("");

  const [kbDocs, setKbDocs] = useState<KbDocument[]>([]);
  const [selectedKbFile, setSelectedKbFile] = useState("");
  const [kbQuestion, setKbQuestion] = useState("");
  const [kbAnswer, setKbAnswer] = useState("");
  const [trainTags, setTrainTags] = useState("");
  const [trainBusy, setTrainBusy] = useState(false);

  const [availability, setAvailability] = useState<AvailabilityConfig | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistItem[]>([]);
  const [schedBusy, setSchedBusy] = useState(false);

  const [apptPatientName, setApptPatientName] = useState("");
  const [apptPatientEmail, setApptPatientEmail] = useState("");
  const [apptPatientPhone, setApptPatientPhone] = useState("");
  const [apptReason, setApptReason] = useState("");
  const [apptNotes, setApptNotes] = useState("");
  const [apptDate, setApptDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [apptTime, setApptTime] = useState("09:00");
  const [apptDuration, setApptDuration] = useState(30);
  const [allowWaitlist, setAllowWaitlist] = useState(true);
  const [showAssistantIntakePicker, setShowAssistantIntakePicker] = useState(false);
  const [selectedAssistantIntakeId, setSelectedAssistantIntakeId] = useState("");
  const [useDoctorTemplateForPdf, setUseDoctorTemplateForPdf] = useState(false);
  const [useMedicalCertificateTemplateForPdf, setUseMedicalCertificateTemplateForPdf] = useState(false);
  const [generatedDocuments, setGeneratedDocuments] = useState<IndexedDocument[]>([]);
  const [documentViewer, setDocumentViewer] = useState<{ url: string; title: string } | null>(null);
  const documentViewerRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await ensureFreshLoginState();
      if (cancelled) return;
      const role = await fetchPortalSession();
      if (cancelled) return;
      if (role === "assistant") {
        router.replace("/assistant/?notice=doctor_locked");
        return;
      }
      if (role !== "doctor") {
        router.replace("/login/?next=doctor");
        return;
      }
      setAccessChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const setUiError = (e: unknown, fallback: string) => {
    setError(e instanceof Error ? e.message : fallback);
  };

  const formatLocal = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  const extractDobFromText = (text: string) => {
    const m = (text || "").match(/(?:Date of Birth|DOB)\s*:\s*([^\n\r]+)/i);
    return (m?.[1] || "").trim();
  };

  const extractPatientNameFromText = (text: string) => {
    const labeled = (text || "").match(/(?:Full Name|Patient Name)\s*:\s*([^\n\r]+)/i);
    if ((labeled?.[1] || "").trim()) return labeled?.[1].trim() || "";
    const assistantHeader = (text || "").match(/\[Assistant intake selected\]\s*([^\n\r]+)/i);
    return (assistantHeader?.[1] || "").trim();
  };

  const extractLabeledValue = (text: string, labels: string[]) => {
    const lines = (text || "").replace(/\r/g, "\n").split("\n");
    for (const raw of lines) {
      const line = (raw || "").trim();
      if (!line) continue;
      const lower = line.toLowerCase();
      for (const label of labels) {
        const lbl = (label || "").trim().toLowerCase();
        if (!lbl) continue;
        if (lower.startsWith(lbl)) {
          return line.slice(lbl.length).trim();
        }
      }
    }
    return "";
  };

  const computeAgeFromDob = (dob: string) => {
    const raw = (dob || "").trim();
    if (!raw) return "";
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) return "";
    const now = new Date();
    let age = now.getFullYear() - dt.getFullYear();
    const birthdayThisYear = new Date(
      now.getFullYear(),
      dt.getMonth(),
      dt.getDate(),
    );
    if (now < birthdayThisYear) age -= 1;
    return age >= 0 ? String(age) : "";
  };

  const buildDoctorTemplateNote = (noteText: string) => {
    const patientName =
      apptPatientName.trim() || extractPatientNameFromText(noteText) || "________________";
    const patientDob = extractDobFromText(noteText);
    const ageFromNote = extractLabeledValue(noteText, ["Age:", "Age/Gender:"]);
    const genderFromNote = extractLabeledValue(noteText, ["Gender:", "Sex:"]);
    const derivedAge = computeAgeFromDob(patientDob);
    const address = extractLabeledValue(noteText, ["Address:"]);
    const followUp =
      apptNotes.trim() || extractLabeledValue(noteText, ["Follow up:", "Follow-up:"]);
    const visitDate = (apptDate || "").trim() || new Date().toISOString().slice(0, 10);

    let ageGender = "";
    if (ageFromNote && genderFromNote) ageGender = `${ageFromNote} / ${genderFromNote}`;
    else if (ageFromNote) ageGender = ageFromNote;
    else if (derivedAge && genderFromNote) ageGender = `${derivedAge} / ${genderFromNote}`;
    else ageGender = derivedAge || genderFromNote;

    const templateNote = [
      "DOCTOR TEMPLATE",
      "Physician: RICHELLE JOY DIAMANTE-BAYSON, MD, FPCP, FPRA",
      "Specialty: Internal Medicine (Adult Diseases Specialist), Rheumatology, Clinical Immunology & Osteoporosis",
      "",
      `Patient Name: ${patientName}`,
      `Age/Gender: ${ageGender || "________________"}`,
      `Address: ${address || "________________"}`,
      `Date: ${visitDate}`,
      "",
      "RX / Clinical Orders:",
      noteText.trim() || "(No clinical note provided.)",
      "",
      "Follow up on:",
      followUp || "As advised by attending physician.",
      "",
      "Signature:",
      "Richelle Joy D. Bayson, MD",
      "Lic. No.: 0114277",
      "PTR No.: 9234542",
    ].join("\n");

    return {
      note: templateNote,
      patientName: patientName.trim(),
      patientDob: patientDob.trim(),
    };
  };

  const buildMedicalCertificateTemplatePayload = (noteText: string) => {
    const patientDob = extractDobFromText(noteText);
    const patientGender = extractLabeledValue(noteText, ["Gender:", "Sex:"]).trim();
    const patientAddress = extractLabeledValue(noteText, ["Address:"]).trim();
    const ageRaw = extractLabeledValue(noteText, ["Age:", "Age/Gender:"]).trim();
    const computedAge = computeAgeFromDob(patientDob);
    const patientAge = ageRaw || computedAge;

    let patientAgeGender = extractLabeledValue(noteText, ["Age/Gender:"]).trim();
    if (!patientAgeGender) {
      if (patientAge && patientGender) patientAgeGender = `${patientAge} / ${patientGender}`;
      else patientAgeGender = patientAge || patientGender;
    }

    return {
      patient_dob: patientDob,
      patient_gender: patientGender,
      patient_address: patientAddress,
      patient_age: patientAge,
      patient_age_gender: patientAgeGender,
      requested_for: apptReason.trim() || "clinic documentation",
    };
  };

  const refreshScheduling = async () => {
    setSchedBusy(true);
    setError("");
    setStatus("Loading scheduling data...");
    try {
      const [a, ap, wl] = await Promise.all([
        getJson<AvailabilityConfig>("/availability"),
        getJson<{ items: Appointment[] }>("/appointments"),
        getJson<{ items: WaitlistItem[] }>("/waitlist"),
      ]);
      setAvailability(a);
      setAppointments(ap.items ?? []);
      setWaitlist(wl.items ?? []);
      setStatus("Scheduling data loaded.");
    } catch (e) {
      setUiError(e, "Failed to load scheduling data.");
    } finally {
      setSchedBusy(false);
    }
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

  const saveAvailability = async () => {
    if (!availability) return;
    setSchedBusy(true);
    setError("");
    setStatus("Saving availability...");
    try {
      const resp = await postJson<{ ok: boolean; availability: AvailabilityConfig }>(
        "/availability",
        availability,
      );
      setAvailability(resp.availability);
      setStatus("Availability saved.");
    } catch (e) {
      setUiError(e, "Failed to save availability.");
    } finally {
      setSchedBusy(false);
    }
  };

  const createAppointment = async () => {
    const patient_name = apptPatientName.trim();
    if (!patient_name) {
      setError("Patient name is required.");
      return;
    }
    const startLocal = new Date(`${apptDate}T${apptTime}`);
    const start_time = startLocal.toISOString();

    setSchedBusy(true);
    setError("");
    setStatus("Creating appointment...");
    try {
      const resp = await postJson<{
        ok: boolean;
        appointment?: Appointment;
        waitlisted?: boolean;
      }>("/appointments", {
        patient_name,
        patient_email: apptPatientEmail.trim(),
        patient_phone: apptPatientPhone.trim(),
        reason: apptReason.trim(),
        notes: apptNotes.trim(),
        start_time,
        duration_minutes: apptDuration,
        allow_waitlist: allowWaitlist,
      });

      if (resp.waitlisted) {
        setStatus("Time slot was full; patient added to waitlist.");
      } else {
        setStatus(`Appointment created${resp.appointment?.id ? ` (${resp.appointment.id})` : ""}.`);
      }
      await refreshScheduling();
    } catch (e) {
      setUiError(e, "Failed to create appointment.");
    } finally {
      setSchedBusy(false);
    }
  };

  const updateAppointmentStatus = async (id: string, status: Appointment["status"]) => {
    setSchedBusy(true);
    setError("");
    setStatus(`Updating appointment ${id}...`);
    try {
      await patchJson(`/appointments/${id}`, { status });
      setStatus(`Appointment updated: ${id}.`);
      await refreshScheduling();
    } catch (e) {
      setUiError(e, "Failed to update appointment.");
    } finally {
      setSchedBusy(false);
    }
  };

  const sendReminder = async (id: string) => {
    setSchedBusy(true);
    setError("");
    setStatus(`Sending reminder for ${id}...`);
    try {
      await postJson(`/appointments/${id}/send_reminder`, {});
      setStatus("Reminder sent.");
      await refreshScheduling();
    } catch (e) {
      setUiError(e, "Failed to send reminder.");
    } finally {
      setSchedBusy(false);
    }
  };

  const convertWaitlistItem = async (w: WaitlistItem) => {
    if (!w?.id) return;
    if ((w.status ?? "waiting") !== "waiting") {
      setError("Only waiting items can be converted.");
      return;
    }
    const start_time = (w.preferred_start_time ?? "").trim();
    if (!start_time) {
      setError("This waitlist item has no preferred start time.");
      return;
    }

    setSchedBusy(true);
    setError("");
    setStatus(`Converting waitlist item ${w.id}...`);
    try {
      await postJson(`/waitlist/${w.id}/convert`, { start_time });
      setStatus(`Waitlist item converted: ${w.id}.`);
      await refreshScheduling();
    } catch (e) {
      setUiError(e, "Failed to convert waitlist item.");
    } finally {
      setSchedBusy(false);
    }
  };

  const appendToNote = (text: string) => {
    setDoctorNote((prev) => `${prev}${prev.trim() ? "\n\n" : ""}${text}`.trim());
  };

  const normalizeStoredPath = (path: string) => {
    const clean = (path || "").trim();
    if (!clean) return "";
    if (clean.startsWith("/")) return clean;
    return `/storage/${clean.replace(/^\/+/, "")}`;
  };

  const openDocumentViewer = (storedPath: string, title: string) => {
    const normalized = normalizeStoredPath(storedPath);
    if (!normalized) return;
    setDocumentViewer({
      url: normalized,
      title: title || "Patient document",
    });
  };

  const openStoredPdf = (storedPath: string, title = "Patient document") => {
    if (typeof window === "undefined") return;
    openDocumentViewer(storedPath, title);
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
      // Fallback for viewers that block iframe printing.
    }
    if (documentViewer?.url) {
      window.open(documentViewer.url, "_blank", "noopener,noreferrer");
      setStatus("Opened document in a new tab. Use browser print there.");
    }
  };

  const escapeCsvCell = (value: string) => `"${(value || "").replace(/"/g, "\"\"")}"`;

  const generateCensus = () => {
    const rows: string[] = [];
    rows.push(
      [
        "source",
        "record_id",
        "patient_name",
        "date_of_birth",
        "chief_complaint",
        "created_at",
        "filename",
      ].join(","),
    );

    for (const intake of assistantIntakes) {
      rows.push(
        [
          "assistant_intake",
          escapeCsvCell(intake.id || ""),
          escapeCsvCell(intake.full_name || ""),
          escapeCsvCell(intake.date_of_birth || ""),
          escapeCsvCell(intake.chief_complaint || ""),
          escapeCsvCell(intake.created_at || ""),
          escapeCsvCell(""),
        ].join(","),
      );
    }

    for (const record of records) {
      const m = (record.filename || "").match(/^(.+?) \((.+?)\)/);
      const parsedName = (m?.[1] || "").trim();
      const parsedDob = (m?.[2] || "").trim();
      rows.push(
        [
          "doctor_record",
          escapeCsvCell(record.id || ""),
          escapeCsvCell(parsedName || record.title || ""),
          escapeCsvCell(parsedDob),
          escapeCsvCell(""),
          escapeCsvCell(record.created_at || ""),
          escapeCsvCell(record.filename || ""),
        ].join(","),
      );
    }

    const ts = new Date().toISOString().replace(/[:]/g, "-");
    const filename = `patient_census_${ts}.csv`;
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(
      `Census generated: ${assistantIntakes.length} assistant intake(s), ${records.length} doctor record(s).`,
    );
  };

  const refreshGeneratedDocuments = async () => {
    try {
      const resp = await getJson<{
        items: Array<{
          id: string;
          document_type?: string;
          title?: string;
          patient_name?: string;
          patient_dob?: string;
          filename: string;
          path: string;
          created_at?: string;
          size_bytes?: number;
          stored_path?: string;
        }>;
      }>("/documents/pdfs");
      const items: IndexedDocument[] = (resp.items ?? []).map((doc) => {
        const relPath = (doc.path || "").replace(/^\/+/, "");
        return {
          id: doc.id || relPath,
          document_type: doc.document_type || "document",
          title: doc.title || doc.filename || "Document",
          patient_name: doc.patient_name || "",
          patient_dob: doc.patient_dob || "",
          filename: doc.filename || relPath,
          path: relPath,
          stored_path: normalizeStoredPath(doc.stored_path || relPath),
          created_at: doc.created_at || "",
          size_bytes: doc.size_bytes,
        };
      });
      setGeneratedDocuments(items);
    } catch {
      // Keep existing lists usable even if document index refresh fails.
    }
  };

  const analyzeCaseNote = async (note: string) => {
    const refNames = kbDocs
      .filter((d) => (d.tags ?? []).every((t) => t !== "patient-record"))
      .slice(0, 5)
      .map((d) => d.filename);
    const resp = await postJson<{ analysis: string }>("/analyze_case", {
      note,
      reference_names: refNames,
    });
    return resp.analysis ?? "";
  };

  const buildAssistantIntakeNote = (resp: {
    meta?: IntakeListItem;
    intake?: PatientIntakeData;
    intake_summary?: string;
    enhanced_report?: string;
  }) => {
    const intake = resp.intake;
    const name = resp.meta?.full_name || intake?.FullName || "Unknown patient";
    const parts: string[] = [`[Assistant intake selected] ${name}`];

    if (intake?.DateOfBirth) parts.push(`DOB: ${intake.DateOfBirth}`);
    if (intake?.ChiefComplaint) parts.push(`Chief complaint: ${intake.ChiefComplaint}`);
    if ((resp.intake_summary || "").trim()) {
      parts.push(`Intake summary:\n${(resp.intake_summary || "").trim()}`);
    }
    if ((resp.enhanced_report || "").trim()) {
      parts.push(`Enhanced report:\n${(resp.enhanced_report || "").trim()}`);
    }

    return { name, noteText: parts.join("\n\n") };
  };

  const buildAssistantIntakePdf = async (resp: {
    meta?: IntakeListItem;
    intake?: PatientIntakeData;
    intake_summary?: string;
    enhanced_report?: string;
  }) => {
    if (!resp.intake) return null;
    const { name } = buildAssistantIntakeNote(resp);
    const pdfResp = await postJson<{ ok: boolean; document: GeneratedPdfDocument }>(
      "/documents/intake_pdf",
      {
        intake: resp.intake,
        enhanced_report: resp.enhanced_report ?? "",
        title: `Assistant Intake Record - ${name}`,
      },
    );
    if (!pdfResp.document?.stored_path) return null;
    return pdfResp.document;
  };

  const refreshPatientRecords = async () => {
    setError("");
    setStatus("Loading doctor records and assistant intakes...");
    try {
      const [recordsResp, intakesResp, docsResp] = await Promise.all([
        getJson<{ items: PatientRecordListItem[] }>("/patient_records"),
        getJson<{ items: IntakeListItem[] }>("/intakes"),
        getJson<{
          items: Array<{
            id: string;
            document_type?: string;
            title?: string;
            patient_name?: string;
            patient_dob?: string;
            filename: string;
            path: string;
            created_at?: string;
            size_bytes?: number;
            stored_path?: string;
          }>;
        }>("/documents/pdfs"),
      ]);
      const doctorRecords = recordsResp.items ?? [];
      const intakeItems = intakesResp.items ?? [];
      const docItems: IndexedDocument[] = (docsResp.items ?? []).map((doc) => {
        const relPath = (doc.path || "").replace(/^\/+/, "");
        return {
          id: doc.id || relPath,
          document_type: doc.document_type || "document",
          title: doc.title || doc.filename || "Document",
          patient_name: doc.patient_name || "",
          patient_dob: doc.patient_dob || "",
          filename: doc.filename || relPath,
          path: relPath,
          stored_path: normalizeStoredPath(doc.stored_path || relPath),
          created_at: doc.created_at || "",
          size_bytes: doc.size_bytes,
        };
      });
      setRecords(doctorRecords);
      setAssistantIntakes(intakeItems);
      setGeneratedDocuments(docItems);
      if (!selectedAssistantIntakeId && intakeItems[0]?.id) {
        setSelectedAssistantIntakeId(intakeItems[0].id);
      } else if (
        selectedAssistantIntakeId &&
        !intakeItems.some((item) => item.id === selectedAssistantIntakeId)
      ) {
        setSelectedAssistantIntakeId(intakeItems[0]?.id ?? "");
      }
      setStatus([
        `Loaded ${doctorRecords.length} doctor record(s)`,
        `${intakeItems.length} assistant intake(s)`,
        `${docItems.length} generated document(s).`,
      ].join(", "));
    } catch (e) {
      setUiError(e, "Failed to load patient records.");
    }
  };

  const appendAssistantIntakeToNote = async (recordId: string) => {
    setError("");
    setStatus(`Loading assistant intake ${recordId}...`);
    try {
      const resp = await getJson<{
        meta?: IntakeListItem;
        intake?: PatientIntakeData;
        intake_summary?: string;
        enhanced_report?: string;
      }>(`/intakes/${recordId}`);

      appendToNote(buildAssistantIntakeNote(resp).noteText);
      setStatus(`Assistant intake ${recordId} appended to doctor note.`);
    } catch (e) {
      setUiError(e, "Failed to load assistant intake.");
    }
  };

  const openAssistantIntakeAndAnalyze = (recordId: string) => {
    setError("");
    setStatus(`Opening assistant intake ${recordId}...`);
    startBusy(async () => {
      try {
        const resp = await getJson<{
          meta?: IntakeListItem;
          intake?: PatientIntakeData;
          intake_summary?: string;
          enhanced_report?: string;
        }>(`/intakes/${recordId}`);

        const { name, noteText } = buildAssistantIntakeNote(resp);
        setDoctorNote(noteText);
        setApptPatientName((prev) => prev || name);

        let pdfOpened = false;
        if (resp.intake) {
          try {
            const doc = await buildAssistantIntakePdf(resp);
            if (doc?.stored_path) {
              openStoredPdf(doc.stored_path, doc.filename || `Assistant Intake Record - ${name}`);
              pdfOpened = true;
              await refreshGeneratedDocuments();
            }
          } catch {
            pdfOpened = false;
          }
        }

        const aiAnalysis = await analyzeCaseNote(noteText);
        setAnalysis(aiAnalysis);
        setStatus(
          pdfOpened
            ? `Loaded ${name}, opened patient PDF, and completed AI analysis.`
            : `Loaded ${name} and completed AI analysis.`,
        );
      } catch (e) {
        setUiError(e, "Failed to open assistant intake for analysis.");
      }
    });
  };

  const openAssistantIntakePdf = (recordId: string) => {
    setError("");
    setStatus(`Preparing intake PDF for ${recordId}...`);
    startBusy(async () => {
      try {
        const resp = await getJson<{
          meta?: IntakeListItem;
          intake?: PatientIntakeData;
          intake_summary?: string;
          enhanced_report?: string;
        }>(`/intakes/${recordId}`);
        const doc = await buildAssistantIntakePdf(resp);
        if (!doc?.stored_path) {
          setError("Could not generate intake PDF for this record.");
          return;
        }
        openStoredPdf(doc.stored_path, doc.filename || "Assistant Intake Record");
        setStatus(`Opened intake PDF: ${doc.filename}`);
        await refreshGeneratedDocuments();
      } catch (e) {
        setUiError(e, "Failed to open intake PDF.");
      }
    });
  };

  const toggleAssistantIntakePicker = async () => {
    const next = !showAssistantIntakePicker;
    setShowAssistantIntakePicker(next);
    if (!next) return;

    if (!assistantIntakes.length) {
      await refreshPatientRecords();
    }
  };

  const refreshKb = async () => {
    setError("");
    setStatus("Loading local references / KB...");
    try {
      const resp = await getJson<{ trained_documents: number; documents: KbDocument[] }>(
        "/train_ai/status",
      );
      setKbDocs(resp.documents ?? []);
      if (!selectedKbFile && resp.documents?.[0]?.filename) {
        setSelectedKbFile(resp.documents[0].filename);
      }
      setStatus(`Loaded ${resp.trained_documents ?? 0} trained document(s).`);
    } catch (e) {
      setUiError(e, "Failed to load KB status.");
    }
  };

  const handleAttachFile = async (file: File) => {
    setError("");
    setStatus(`Extracting attachment: ${file.name}`);
    try {
      const form = new FormData();
      form.append("file", file);
      const resp = await postMultipart<{
        extracted_text: string;
        message?: string;
        stored_path?: string;
      }>("/attachments/extract", form);
      const noteBlock = [
        `[Attachment: ${file.name}]`,
        resp.extracted_text?.trim()
          ? resp.extracted_text.trim()
          : resp.message || "No text extracted.",
      ].join("\n");
      appendToNote(noteBlock);
      setStatus(`Attachment processed: ${file.name}`);
    } catch (e) {
      setUiError(e, "Attachment processing failed.");
    }
  };

  const handleAttachHandwrittenRx = async (file: File) => {
    setError("");
    setStatus(`Parsing handwritten RX: ${file.name}`);
    try {
      const form = new FormData();
      form.append("file", file);
      const patientName = apptPatientName.trim() || extractPatientNameFromText(doctorNote);
      const patientDob = extractDobFromText(doctorNote);
      if (patientName) form.append("patient_name", patientName);
      if (patientDob) form.append("patient_dob", patientDob);

      const resp = await postMultipart<{
        extracted_text: string;
        message?: string;
        stored_path?: string;
        ocr_engine?: string;
      }>("/attachments/extract", form);

      const parsedText = resp.extracted_text?.trim()
        ? resp.extracted_text.trim()
        : resp.message || "No readable text detected from handwritten RX.";
      appendToNote(`[Handwritten RX: ${file.name}]\n${parsedText}`);

      if (resp.extracted_text?.trim()) {
        setStatus(`Handwritten RX parsed and added to Doctor Note: ${file.name}`);
      } else {
        setStatus(`Handwritten RX uploaded, but OCR found limited/no text: ${file.name}`);
      }
    } catch (e) {
      setUiError(e, "Handwritten RX processing failed.");
    }
  };

  const handleAnalyze = () => {
    setError("");
    setStatus("Analyzing case...");
    startBusy(async () => {
      try {
        const aiAnalysis = await analyzeCaseNote(doctorNote);
        setAnalysis(aiAnalysis);
        setStatus("Case analysis complete.");
      } catch (e) {
        setUiError(e, "Analyze failed.");
      }
    });
  };

  const handleRevise = () => {
    setError("");
    setStatus("Revising medical report...");
    startBusy(async () => {
      try {
        const resp = await postJson<{ reply: string }>("/chat", {
          history: [
            { role: "system", content: reviseSystemPrompt },
            { role: "user", content: doctorNote },
          ],
        });
        setDoctorNote(resp.reply ?? doctorNote);
        setStatus("Doctor note revised.");
      } catch (e) {
        setUiError(e, "Revision failed.");
      }
    });
  };

  const handleSavePatientRecord = () => {
    setError("");
    setStatus("Saving patient record...");
    startBusy(async () => {
      try {
        const resp = await postJson<{ record: PatientRecordListItem }>("/patient_records", {
          note: doctorNote,
        });
        setStatus(`Patient record saved: ${resp.record?.filename ?? ""}`);
        await refreshPatientRecords();
        await refreshKb();
      } catch (e) {
        setUiError(e, "Save patient record failed.");
      }
    });
  };

  const generatePatientRecordPdf = () => {
    const clean = doctorNote.trim();
    if (!clean) {
      setError("Doctor note is empty.");
      return;
    }
    setError("");
    setStatus("Generating patient record PDF...");
    startBusy(async () => {
      try {
        const fallbackPatientName = (
          apptPatientName.trim() || extractPatientNameFromText(clean)
        ).trim();
        const fallbackPatientDob = extractDobFromText(clean);
        const templatePayload = useDoctorTemplateForPdf
          ? buildDoctorTemplateNote(clean)
          : null;
        const noteForPdf = templatePayload?.note || clean;
        const patientNameForPdf = templatePayload?.patientName || fallbackPatientName;
        const patientDobForPdf = templatePayload?.patientDob || fallbackPatientDob;
        const resp = await postJson<{ ok: boolean; document: GeneratedPdfDocument }>(
          "/documents/patient_record_pdf",
          {
            note: noteForPdf,
            title: useDoctorTemplateForPdf
              ? "Doctor Patient Record (Template)"
              : "Doctor Patient Record",
            patient_name: patientNameForPdf,
            patient_dob: patientDobForPdf,
            source_role: "doctor",
          },
        );
        setStatus(
          `${useDoctorTemplateForPdf ? "Template-applied " : ""}patient record PDF ready: ${resp.document.filename}`,
        );
        openStoredPdf(resp.document.stored_path, resp.document.filename || "Patient Record PDF");
        await refreshGeneratedDocuments();
      } catch (e) {
        setUiError(e, "Failed to generate patient record PDF.");
      }
    });
  };

  const generateMedicalCertificatePdf = () => {
    const defaultPatient = apptPatientName.trim();
    const patientName = (window.prompt("Patient name", defaultPatient) || "").trim();
    if (!patientName) {
      setError("Patient name is required to generate a medical certificate.");
      return;
    }
    const diagnosis = window.prompt("Diagnosis / impression", apptReason || "") ?? "";
    const recommendations =
      window.prompt("Recommendations", "Patient is advised to follow up and rest as needed.") ?? "";
    const dobDefault = extractDobFromText(doctorNote);
    const patientDob = (window.prompt("Date of birth (optional)", dobDefault) || "").trim();
    const restDaysRaw = window.prompt("Rest days (optional integer)", "1");
    const doctorName = window.prompt("Doctor name", "") ?? "";
    const doctorLicense = window.prompt("Doctor license (optional)", "") ?? "";
    const clinicName = window.prompt("Clinic / facility name", "") ?? "";
    const restDays = restDaysRaw && /^\d+$/.test(restDaysRaw.trim()) ? Number(restDaysRaw.trim()) : null;
    const templatePayload = buildMedicalCertificateTemplatePayload(doctorNote);

    setError("");
    setStatus("Generating medical certificate PDF...");
    startBusy(async () => {
      try {
        const resp = await postJson<{ ok: boolean; document: GeneratedPdfDocument }>(
          "/documents/medical_certificate_pdf",
          {
            patient_name: patientName,
            patient_dob: patientDob,
            diagnosis,
            recommendations,
            rest_days: restDays,
            doctor_name: doctorName,
            doctor_license: doctorLicense,
            clinic_name: clinicName,
            additional_notes: doctorNote.slice(0, 1200),
            patient_address: templatePayload.patient_address,
            patient_gender: templatePayload.patient_gender,
            patient_age: templatePayload.patient_age,
            patient_age_gender: templatePayload.patient_age_gender,
            requested_for: templatePayload.requested_for,
            use_doctor_template: useMedicalCertificateTemplateForPdf,
            certificate_title: useMedicalCertificateTemplateForPdf
              ? "Medical Certificate (Doctor Template)"
              : "Medical Certificate",
          },
        );
        setStatus(
          `${useMedicalCertificateTemplateForPdf ? "Template-applied " : ""}medical certificate PDF ready: ${resp.document.filename}`,
        );
        openStoredPdf(resp.document.stored_path, resp.document.filename || "Medical Certificate PDF");
        await refreshGeneratedDocuments();
      } catch (e) {
        setUiError(e, "Failed to generate medical certificate PDF.");
      }
    });
  };

  const generateMedicalCertificatePdfAi = () => {
    const clean = doctorNote.trim();
    if (!clean) {
      setError("Doctor note is empty.");
      return;
    }
    const patientName =
      apptPatientName.trim() || extractPatientNameFromText(clean);
    if (!patientName) {
      setError("Patient name is required before generating AI medical certificate.");
      return;
    }
    const templatePayload = buildMedicalCertificateTemplatePayload(clean);

    setError("");
    setStatus("Generating AI medical certificate PDF...");
    startBusy(async () => {
      try {
        const resp = await postJson<{
          ok: boolean;
          document: GeneratedPdfDocument;
          ai_used?: boolean;
        }>("/documents/medical_certificate_pdf_ai", {
          patient_name: patientName,
          patient_dob: templatePayload.patient_dob,
          patient_address: templatePayload.patient_address,
          patient_gender: templatePayload.patient_gender,
          patient_age: templatePayload.patient_age,
          patient_age_gender: templatePayload.patient_age_gender,
          doctor_note: clean,
          analysis,
          appointment_reason: apptReason,
          appointment_notes: apptNotes,
          requested_for: templatePayload.requested_for,
          use_doctor_template: useMedicalCertificateTemplateForPdf,
          certificate_title: useMedicalCertificateTemplateForPdf
            ? "Medical Certificate (Doctor Template)"
            : "Medical Certificate",
        });
        setStatus(
          `${useMedicalCertificateTemplateForPdf ? "Template-applied " : ""}medical certificate PDF ready (${resp.ai_used ? "LLM draft" : "fallback draft"}): ${resp.document.filename}`,
        );
        openStoredPdf(resp.document.stored_path, resp.document.filename || "Medical Certificate PDF");
        await refreshGeneratedDocuments();
      } catch (e) {
        setUiError(e, "Failed to generate AI medical certificate PDF.");
      }
    });
  };

  const sendChat = () => {
    const message = chatInput.trim();
    if (!message) return;
    setError("");
    setStatus("Sending chat message...");
    const nextHistory: ChatMessage[] = [
      ...chatHistory,
      { role: "user", content: message },
    ];
    setChatHistory(nextHistory);
    setChatInput("");
    startBusy(async () => {
      try {
        const resp = await postJson<{ reply: string }>("/chat", {
          history: nextHistory,
        });
        setChatHistory((prev) => [
          ...prev,
          { role: "assistant", content: resp.reply ?? "No response." },
        ]);
        setStatus("Chat reply received.");
      } catch (e) {
        setUiError(e, "Chat failed.");
      }
    });
  };

  const askSelectedKb = () => {
    if (!selectedKbFile) return;
    setError("");
    setStatus(`Querying ${selectedKbFile}...`);
    startBusy(async () => {
      try {
        const resp = await postJson<{ answer: string }>("/ask_pdf", {
          filename: selectedKbFile,
          history: [{ role: "user", content: kbQuestion || "Summarize relevance to this case" }],
        });
        setKbAnswer(resp.answer ?? "");
        setStatus(`KB answer received from ${selectedKbFile}.`);
      } catch (e) {
        setUiError(e, "KB query failed.");
      }
    });
  };

  const trainFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setTrainBusy(true);
    setError("");
    setStatus(`Training on ${files.length} file(s)...`);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        if (trainTags.trim()) form.append("tags", trainTags.trim());
        await postMultipart("/train_ai/upload", form);
      }
      setStatus(`Training upload complete (${files.length} file(s)).`);
      await refreshKb();
    } catch (e) {
      setUiError(e, "Train AI upload failed.");
    } finally {
      setTrainBusy(false);
    }
  };

  const runMedicalReferences = () => {
    if (!refQuery.trim()) return;
    setError("");
    setStatus("Fetching medical references...");
    startBusy(async () => {
      try {
        const resp = await postJson<{
          summary_text: string;
          report_text: string;
        }>("/medical_references", {
          query: refQuery,
          max_pubmed: 6,
          max_trials: 5,
          max_rxnorm: 15,
          summarize: true,
          max_summary_paragraphs: 3,
        });
        setRefSummary(resp.summary_text ?? "");
        setRefReport(resp.report_text ?? "");
        setStatus("Medical references report ready.");
      } catch (e) {
        setUiError(e, "Medical references lookup failed.");
      }
    });
  };

  const runRxLookup = () => {
    if (!rxQuery.trim()) return;
    setError("");
    setStatus("Looking up medication in RxNav...");
    startBusy(async () => {
      try {
        const resp = await getJson<{ items: string[] }>(
          `/rxnav_lookup?query=${encodeURIComponent(rxQuery.trim())}`,
        );
        setRxResults(resp.items ?? []);
        setStatus(`RxNav lookup returned ${resp.items?.length ?? 0} item(s).`);
      } catch (e) {
        setUiError(e, "RxNav lookup failed.");
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

  const quickPdfDocuments = generatedDocuments.filter((d) =>
    ((d.filename || d.path || "").trim().toLowerCase().endsWith(".pdf")),
  );

  return (
    <main className="shell stack" data-testid="doctor-page">
      <section className="hero">
        <h1 className="doctor-hero-title">Medical Doctor Workspace</h1>
        <p>
          Clinical command center for physicians: review assistant intakes,
          perform AI-supported case analysis, manage scheduling, generate
          patient documents, and maintain complete patient records for final
          doctor-reviewed decisions.
        </p>
        <nav className="hero-nav">
          <Link href="/">Home</Link>
          <Link href="/assistant">Assistant Portal</Link>
          <button
            className="nav-chip-btn"
            type="button"
            data-testid="doctor-logout"
            onClick={handleLogout}
            disabled={busy}
          >
            Logout
          </button>
          <button
            className="nav-chip-btn"
            data-testid="doctor-refresh-kb"
            onClick={() => void refreshKb()}
          >
            Refresh KB
          </button>
          <button
            className="nav-chip-btn"
            data-testid="doctor-refresh-patient-records"
            onClick={() => void refreshPatientRecords()}
          >
            Refresh patient/intake records
          </button>
        </nav>
      </section>

      <Panel title="Scheduling" subtitle="Appointments, availability, waitlist, reminders">
        <div className="stack" style={{ gap: 12 }}>
          <div className="hero-nav" style={{ alignItems: "center" }}>
            <button className="btn ghost" onClick={() => void refreshScheduling()} disabled={schedBusy}>
              {schedBusy ? "Loading..." : "Refresh scheduling"}
            </button>
            <SmallMeta>
              API: <code>/appointments</code>, <code>/availability</code>, <code>/waitlist</code>
            </SmallMeta>
          </div>

          <div className="page-grid columns-2">
            <div className="stack" style={{ gap: 12 }}>
              <div className="field-grid">
                <div className="field">
                  <label>Patient name</label>
                  <input value={apptPatientName} onChange={(e) => setApptPatientName(e.target.value)} />
                </div>
                <div className="field">
                  <label>Patient email (for reminders)</label>
                  <input value={apptPatientEmail} onChange={(e) => setApptPatientEmail(e.target.value)} />
                </div>
                <div className="field">
                  <label>Patient phone</label>
                  <input value={apptPatientPhone} onChange={(e) => setApptPatientPhone(e.target.value)} />
                </div>
                <div className="field">
                  <label>Reason</label>
                  <input value={apptReason} onChange={(e) => setApptReason(e.target.value)} />
                </div>
                <div className="field">
                  <label>Date</label>
                  <input type="date" value={apptDate} onChange={(e) => setApptDate(e.target.value)} />
                </div>
                <div className="field">
                  <label>Time</label>
                  <input type="time" value={apptTime} onChange={(e) => setApptTime(e.target.value)} />
                </div>
                <div className="field">
                  <label>Duration (minutes)</label>
                  <select value={apptDuration} onChange={(e) => setApptDuration(Number(e.target.value))}>
                    {[15, 30, 45, 60].map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={allowWaitlist}
                      onChange={(e) => setAllowWaitlist(e.target.checked)}
                    />
                    Add to waitlist if slot is full
                  </label>
                </div>
              </div>
              <div className="field">
                <label>Notes</label>
                <textarea value={apptNotes} onChange={(e) => setApptNotes(e.target.value)} />
              </div>

              <div className="hero-nav">
                <button className="btn" onClick={() => void createAppointment()} disabled={schedBusy}>
                  Create appointment
                </button>
              </div>
            </div>

            <div className="stack" style={{ gap: 12 }}>
              <div className="field">
                <label>Availability (weekly)</label>
                {!availability ? (
                  <SmallMeta>Click “Refresh scheduling” to load availability.</SmallMeta>
                ) : (
                  <div className="stack" style={{ gap: 10 }}>
                    <div className="field" style={{ maxWidth: 220 }}>
                      <label>Slot minutes</label>
                      <input
                        type="number"
                        value={availability.slot_minutes}
                        onChange={(e) =>
                          setAvailability({
                            ...availability,
                            slot_minutes: Number(e.target.value || 15),
                          })
                        }
                      />
                    </div>
                    {availability.windows.map((w, idx) => (
                      <div key={`${w.weekday}-${idx}`} className="field-grid compact-3">
                        <div className="field">
                          <label>Weekday (0=Mon..6=Sun)</label>
                          <input
                            type="number"
                            value={w.weekday}
                            onChange={(e) => {
                              const next = availability.windows.slice();
                              next[idx] = { ...w, weekday: Number(e.target.value) };
                              setAvailability({ ...availability, windows: next });
                            }}
                          />
                        </div>
                        <div className="field">
                          <label>Start</label>
                          <input
                            type="time"
                            value={w.start}
                            onChange={(e) => {
                              const next = availability.windows.slice();
                              next[idx] = { ...w, start: e.target.value };
                              setAvailability({ ...availability, windows: next });
                            }}
                          />
                        </div>
                        <div className="field">
                          <label>End</label>
                          <input
                            type="time"
                            value={w.end}
                            onChange={(e) => {
                              const next = availability.windows.slice();
                              next[idx] = { ...w, end: e.target.value };
                              setAvailability({ ...availability, windows: next });
                            }}
                          />
                        </div>
                      </div>
                    ))}
                    <div className="hero-nav">
                      <button className="btn" onClick={() => void saveAvailability()} disabled={schedBusy}>
                        Save availability
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="page-grid columns-2">
            <div className="stack" style={{ gap: 10 }}>
              <h3 style={{ margin: 0 }}>Upcoming appointments</h3>
              {!appointments.length ? (
                <SmallMeta>No appointments loaded.</SmallMeta>
              ) : (
                <div className="stack" style={{ gap: 10 }}>
                  {appointments.slice(0, 12).map((a) => (
                    <div key={a.id} className="panel" style={{ padding: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <div>
                          <strong>{a.patient_name}</strong>
                          <div className="small-meta">{formatLocal(a.start_time)}</div>
                          <div className="small-meta">Status: {a.status}</div>
                        </div>
                        <div className="hero-nav" style={{ justifyContent: "flex-end" }}>
                          <button className="btn ghost" onClick={() => void updateAppointmentStatus(a.id, "checked_in")}>
                            Check-in
                          </button>
                          <button className="btn ghost" onClick={() => void updateAppointmentStatus(a.id, "completed")}>
                            Complete
                          </button>
                          <button className="btn ghost" onClick={() => void updateAppointmentStatus(a.id, "cancelled")}>
                            Cancel
                          </button>
                          <button className="btn ghost" onClick={() => void sendReminder(a.id)}>
                            Send reminder
                          </button>
                        </div>
                      </div>
                      {a.reason ? <div className="small-meta">Reason: {a.reason}</div> : null}
                      {a.patient_email ? <div className="small-meta">Email: {a.patient_email}</div> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="stack" style={{ gap: 10 }}>
              <h3 style={{ margin: 0 }}>Waitlist</h3>
              {!waitlist.length ? (
                <SmallMeta>No waitlist items.</SmallMeta>
              ) : (
                <div className="stack" style={{ gap: 10 }}>
                  {waitlist.slice(0, 12).map((w) => (
                    <div key={w.id} className="panel" style={{ padding: 12 }}>
                      <strong>{w.patient_name}</strong>
                      <div className="small-meta">Status: {w.status}</div>
                      {w.preferred_start_time ? (
                        <div className="small-meta">Preferred: {formatLocal(w.preferred_start_time)}</div>
                      ) : null}
                      {w.reason ? <div className="small-meta">Reason: {w.reason}</div> : null}

                      <div className="hero-nav" style={{ justifyContent: "flex-start" }}>
                        <button
                          className="btn ghost"
                          onClick={() => void convertWaitlistItem(w)}
                          disabled={schedBusy || (w.status ?? "waiting") !== "waiting" || !w.preferred_start_time}
                        >
                          Convert to appointment
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </Panel>

      <div className={`status${error ? " error" : ""}`} data-testid="doctor-status">
        {error || status}
      </div>

      <div className="page-grid columns-2">
        <Panel title="Doctor Note" subtitle="Follow steps below to complete a doctor-reviewed case">
          <div className="panel" style={{ padding: 12 }}>
            <strong>Recommended flow</strong>
            <ol className="workflow-steps">
              <li>Load assistant patient record first, then review the drafted note.</li>
              <li>Run case analysis and revise wording if needed.</li>
              <li>Save patient record to host storage.</li>
              <li>Generate final PDFs for patient record and certificate.</li>
            </ol>
            <div style={{ marginTop: 10 }}>
              <label
                style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}
              >
                <input
                  type="checkbox"
                  data-testid="doctor-template-toggle"
                  checked={useDoctorTemplateForPdf}
                  onChange={(e) => setUseDoctorTemplateForPdf(e.target.checked)}
                />
                Allow Doctor&apos;s Template for Patient Record PDF
              </label>
              <SmallMeta>
                If enabled, the Doctor Note content is wrapped in your prescription-style template
                before generating the patient-record PDF.
              </SmallMeta>
            </div>
            <div style={{ marginTop: 10 }}>
              <label
                style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}
              >
                <input
                  type="checkbox"
                  data-testid="doctor-medcert-template-toggle"
                  checked={useMedicalCertificateTemplateForPdf}
                  onChange={(e) => setUseMedicalCertificateTemplateForPdf(e.target.checked)}
                />
                Allow Doctor&apos;s Template for Medical Certificate PDF
              </label>
              <SmallMeta>
                If enabled, Medical Certificate PDF follows the template layout with fixed
                clinic header and certificate body format.
              </SmallMeta>
            </div>
          </div>

          <div className="action-help-grid" style={{ marginTop: 10 }}>
            <div className="action-help-item">
              <button
                className="btn primary"
                data-testid="doctor-attach-file-label"
                onClick={() => void toggleAssistantIntakePicker()}
              >
                1) Attach assistant patient record
              </button>
              <SmallMeta>
                Start here. Select the patient created by assistant so Doctor Note can be prefilled.
              </SmallMeta>
            </div>

            <div className="action-help-item">
              <label className="btn accent action-help-upload" data-testid="doctor-upload-local-file-label">
                Upload local file (PDF/Text/Image)
                <input
                  hidden
                  type="file"
                  data-testid="doctor-attach-file-input"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleAttachFile(file);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
              <SmallMeta>
                Optional. Add extra doctor documents/lab files to append text into Doctor Note.
              </SmallMeta>
            </div>

            <div className="action-help-item">
              <button
                className="btn primary"
                data-testid="doctor-analyze-case"
                disabled={busy}
                onClick={handleAnalyze}
              >
                2) Analyze Case
              </button>
              <SmallMeta>
                Generates AI clinical support output on the right panel for doctor review.
              </SmallMeta>
            </div>

            <div className="action-help-item">
              <button
                className="btn accent"
                data-testid="doctor-revise-report"
                disabled={busy}
                onClick={handleRevise}
              >
                Revise Report
              </button>
              <SmallMeta>
                Optional rewrite. Improves structure of Doctor Note while keeping original facts.
              </SmallMeta>
            </div>

            <div className="action-help-item">
              <button
                className="btn primary"
                data-testid="doctor-save-patient-record"
                disabled={busy}
                onClick={handleSavePatientRecord}
              >
                3) Save Patient Record
              </button>
              <SmallMeta>
                Persists this doctor note to host storage for future retrieval and audit trail.
              </SmallMeta>
            </div>

            <div className="action-help-item">
              <button
                className="btn accent"
                data-testid="doctor-generate-patient-pdf"
                disabled={busy}
                onClick={generatePatientRecordPdf}
              >
                4) Generate Patient Record PDF
              </button>
              <SmallMeta>
                Exports the finalized patient case record to PDF for sharing/printing.
              </SmallMeta>
            </div>

            <div className="action-help-item">
              <button
                className="btn primary"
                data-testid="doctor-generate-certificate-pdf"
                disabled={busy}
                onClick={generateMedicalCertificatePdf}
              >
                Generate Medical Certificate PDF
              </button>
              <SmallMeta>
                Optional. Creates medical certificate PDF after diagnosis/recommendation inputs.
              </SmallMeta>
            </div>

            <div className="action-help-item">
              <button className="btn danger" data-testid="doctor-clear-note" onClick={() => setDoctorNote("")}>
                Clear
              </button>
              <SmallMeta>Resets Doctor Note text area for a new case draft.</SmallMeta>
            </div>
          </div>

          <div className="panel stack" style={{ marginTop: 12, padding: 12, gap: 8 }} data-testid="doctor-quick-pdf-card">
            <strong>Patient Record Files</strong>
            <SmallMeta>
              After saving a patient record, select a file below to open PDF reader popup (view or print).
            </SmallMeta>
            <div className="toolbar">
              <button
                className="btn"
                data-testid="doctor-refresh-quick-pdf-list"
                onClick={() => void refreshPatientRecords()}
              >
                Refresh file list
              </button>
              <button
                className="btn accent"
                data-testid="doctor-generate-census"
                onClick={generateCensus}
              >
                Generate Census
              </button>
            </div>
            <div className="list scroll-list" data-testid="doctor-quick-pdf-list">
              {quickPdfDocuments.length === 0 ? (
                <div className="list-item">
                  <SmallMeta>No PDF patient files available yet.</SmallMeta>
                </div>
              ) : (
                quickPdfDocuments.map((d) => (
                  <div className="list-item" key={`quick-${d.id}`} data-testid="doctor-quick-pdf-item">
                    <strong>{d.patient_name || "(Unnamed patient)"}</strong>
                    <SmallMeta>{d.filename}</SmallMeta>
                    <SmallMeta>
                      Type: {d.document_type || "document"} | Created: {d.created_at || "-"}
                    </SmallMeta>
                    <button
                      className="btn primary"
                      data-testid={`doctor-open-quick-pdf-${d.id}`}
                      onClick={() => openStoredPdf(d.stored_path, d.filename || d.title || "Patient document")}
                    >
                      Open PDF (View/Print)
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {showAssistantIntakePicker ? (
            <div
              className="panel stack"
              style={{ marginTop: 12, padding: 12, gap: 10 }}
              data-testid="doctor-assistant-intake-picker"
            >
              <div className="field">
                <label htmlFor="assistantIntakeSelect">Assistant patient intake</label>
                <select
                  id="assistantIntakeSelect"
                  data-testid="doctor-assistant-intake-select"
                  value={selectedAssistantIntakeId}
                  onChange={(e) => setSelectedAssistantIntakeId(e.target.value)}
                >
                  <option value="">Select assistant patient record...</option>
                  {assistantIntakes.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.full_name || "(Unnamed patient)"} | DOB: {i.date_of_birth || "-"} |{" "}
                      {i.created_at}
                    </option>
                  ))}
                </select>
              </div>
              <div className="action-help-grid">
                <div className="action-help-item">
                  <button
                    className="btn primary"
                    data-testid="doctor-open-selected-intake"
                    disabled={busy || !selectedAssistantIntakeId}
                    onClick={() => openAssistantIntakeAndAnalyze(selectedAssistantIntakeId)}
                  >
                    Open Selected Patient + Analyze
                  </button>
                  <SmallMeta>
                    Loads intake into Doctor Note, opens patient PDF, then runs AI analysis.
                  </SmallMeta>
                </div>
                <div className="action-help-item">
                  <button
                    className="btn"
                    data-testid="doctor-refresh-intake-picker"
                    disabled={busy}
                    onClick={() => void refreshPatientRecords()}
                  >
                    Refresh patient records
                  </button>
                  <SmallMeta>Use this if newly saved assistant records are not yet listed.</SmallMeta>
                </div>
              </div>
              <SmallMeta>
                Selecting a patient loads the assistant intake into Doctor Note,
                opens a patient PDF, and runs AI Analysis for doctor review.
              </SmallMeta>
            </div>
          ) : null}
          <textarea
            data-testid="doctor-note"
            value={doctorNote}
            onChange={(e) => setDoctorNote(e.target.value)}
            placeholder="Paste or dictate doctor note here..."
            style={{ minHeight: 360, marginTop: 12 }}
          />
          <div className="panel stack" style={{ marginTop: 12, padding: 12, gap: 8 }}>
            <strong>Prescription (RX) attachment</strong>
            <div className="action-help-grid">
              <div className="action-help-item">
                <label className="btn accent action-help-upload" data-testid="doctor-attach-rx-label">
                  Attach Handwritten RX (Image/PDF)
                  <input
                    hidden
                    type="file"
                    accept="image/*,.pdf,application/pdf"
                    data-testid="doctor-attach-rx-input"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleAttachHandwrittenRx(file);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
                <SmallMeta>
                  Upload doctor handwritten RX and the system will OCR-parse it into text,
                  then append it to Doctor Note so it is saved with the patient record.
                </SmallMeta>
              </div>
            </div>
          </div>
          <div className="panel stack" style={{ marginTop: 12, padding: 12, gap: 8 }}>
            <strong>Final step: AI certificate output</strong>
            <div className="action-help-grid">
              <div className="action-help-item">
                <button
                  className="btn accent"
                  data-testid="doctor-generate-certificate-ai-bottom"
                  disabled={busy}
                  onClick={generateMedicalCertificatePdfAi}
                >
                  Generate Medical Certificate (AI)
                </button>
                <SmallMeta>
                  Uses Doctor Note, AI Analysis, and scheduling notes to auto-draft
                  certificate content, then exports a Medical Certificate PDF.
                </SmallMeta>
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          title="AI Analysis"
          subtitle="Output from /analyze_case (clinical support only; doctor review required)"
        >
          <div className="pre" data-testid="doctor-analysis-output" style={{ minHeight: 428 }}>
            {analysis || "Case analysis output will appear here."}
          </div>
        </Panel>
      </div>

      <div className="page-grid columns-2">
        <Panel title="AI Chat" subtitle="Uses the same backend /chat contract as WinForms">
          <div className="chat-box" data-testid="doctor-chat-box">
            {chatHistory.map((m, idx) => (
              <p className="chat-line" key={`${m.role}-${idx}`}>
                <strong>{m.role}:</strong> {m.content}
              </p>
            ))}
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="chatInput">Message</label>
            <textarea
              id="chatInput"
              data-testid="doctor-chat-input"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  sendChat();
                }
              }}
              placeholder="Ask a question about the case (Ctrl/Cmd+Enter to send)"
            />
          </div>
          <div className="toolbar">
            <button
              className="btn primary"
              data-testid="doctor-chat-send"
              disabled={busy}
              onClick={sendChat}
            >
              Send Chat
            </button>
            <button
              className="btn"
              data-testid="doctor-chat-reset"
              onClick={() =>
                setChatHistory([
                  {
                    role: "assistant",
                    content:
                      "CoPilot Symptomatologist web chat is ready. Ask about the current case or request a rewrite/summary.",
                  },
                ])
              }
            >
              Reset Chat
            </button>
          </div>
        </Panel>

        <Panel title="Medication Lookup (RxNav)">
          <div className="field">
            <label htmlFor="rxQuery">Medication name</label>
            <input
              id="rxQuery"
              data-testid="doctor-rx-query"
              value={rxQuery}
              onChange={(e) => setRxQuery(e.target.value)}
              placeholder="e.g., metformin"
            />
          </div>
          <div className="toolbar">
            <button
              className="btn"
              data-testid="doctor-rx-lookup"
              disabled={busy}
              onClick={runRxLookup}
            >
              Lookup
            </button>
          </div>
          <div className="list" data-testid="doctor-rx-results">
            {rxResults.length === 0 ? (
              <div className="list-item">
                <SmallMeta>RxNav results will appear here.</SmallMeta>
              </div>
            ) : (
              rxResults.map((r) => (
                <div className="list-item" key={r}>
                  {r}
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>

      <div className="page-grid columns-2">
        <Panel title="Local Knowledge Base (Train + Ask)">
          <div className="field">
            <label htmlFor="trainTags">Train AI tags (comma-separated)</label>
            <input
              id="trainTags"
              data-testid="doctor-train-tags"
              value={trainTags}
              onChange={(e) => setTrainTags(e.target.value)}
              placeholder="Cardio, Endocrine, SOAP, Protocol"
            />
          </div>
          <div className="toolbar">
            <label className="btn" data-testid="doctor-train-upload-label">
              {trainBusy ? "Uploading..." : "Train / Upload References"}
              <input
                hidden
                type="file"
                data-testid="doctor-train-upload-input"
                multiple
                accept=".pdf,.txt,.md"
                onChange={(e) => {
                  void trainFiles(e.target.files);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            <button className="btn" data-testid="doctor-refresh-kb-list" onClick={() => void refreshKb()}>
              Refresh KB List
            </button>
          </div>
          <div className="field">
            <label htmlFor="kbSelect">Reference file</label>
            <select
              id="kbSelect"
              data-testid="doctor-kb-select"
              value={selectedKbFile}
              onChange={(e) => setSelectedKbFile(e.target.value)}
            >
              <option value="">Select a reference file...</option>
              {kbDocs
                .filter((d) => !(d.tags ?? []).includes("patient-record"))
                .map((d) => (
                  <option key={d.id} value={d.filename}>
                    {d.filename}
                  </option>
                ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="kbQuestion">Question for selected file</label>
            <textarea
              id="kbQuestion"
              data-testid="doctor-kb-question"
              value={kbQuestion}
              onChange={(e) => setKbQuestion(e.target.value)}
              placeholder="How is this reference relevant to the current case?"
            />
          </div>
          <div className="toolbar">
            <button
              className="btn primary"
              data-testid="doctor-kb-ask"
              disabled={busy || !selectedKbFile}
              onClick={askSelectedKb}
            >
              Ask Selected Reference
            </button>
          </div>
          <div className="pre" data-testid="doctor-kb-answer">
            {kbAnswer || "KB answer output will appear here."}
          </div>
          <SmallMeta>
            Trained document count: {kbDocs.filter((d) => !(d.tags ?? []).includes("patient-record")).length}
          </SmallMeta>
        </Panel>

        <Panel title="Medical References (PubMed + ClinicalTrials + RxNav)">
          <div className="field">
            <label htmlFor="refQuery">Keywords / condition / diagnosis</label>
            <input
              id="refQuery"
              data-testid="doctor-ref-query"
              value={refQuery}
              onChange={(e) => setRefQuery(e.target.value)}
              placeholder="e.g., diabetic ketoacidosis management adult"
            />
          </div>
          <div className="toolbar">
            <button
              className="btn accent"
              data-testid="doctor-ref-fetch"
              disabled={busy}
              onClick={runMedicalReferences}
            >
              Fetch References
            </button>
            <button
              className="btn"
              data-testid="doctor-ref-clear"
              onClick={() => {
                setRefSummary("");
                setRefReport("");
              }}
            >
              Clear
            </button>
          </div>
          <div className="pre" data-testid="doctor-ref-summary">
            {refSummary || "AI evidence summary will appear here."}
          </div>
          <div className="pre" data-testid="doctor-ref-report" style={{ maxHeight: 360 }}>
            {refReport || "Detailed references report will appear here."}
          </div>
        </Panel>
      </div>

      <Panel
        title="Saved Patient Records"
        subtitle="Doctor records plus assistant intakes from host storage"
      >
        <div className="stack" style={{ gap: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>Doctor Records</h3>
            <div className="list" data-testid="doctor-patient-records-list">
              {records.length === 0 ? (
                <div className="list-item">
                  <SmallMeta>No doctor records loaded yet.</SmallMeta>
                </div>
              ) : (
                records.map((r) => (
                  <div className="list-item" key={r.id} data-testid="doctor-patient-record-item">
                    <strong>{r.title}</strong>
                    <SmallMeta>{r.filename}</SmallMeta>
                    <SmallMeta>{r.created_at}</SmallMeta>
                    <div className="toolbar">
                      <button
                        className="btn"
                        data-testid={`doctor-open-record-file-${r.id}`}
                        onClick={() =>
                          openStoredPdf(
                            `/storage/${(r.path || "").replace(/^\/+/, "")}`,
                            r.filename || r.title || "Doctor record",
                          )
                        }
                      >
                        Open file
                      </button>
                      <button
                        className="btn"
                        data-testid={`doctor-append-record-${r.id}`}
                        onClick={() => appendToNote(`[Patient record selected]\n${r.title}\n${r.filename}`)}
                      >
                        Append Reference to Note
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <h3 style={{ margin: 0 }}>Assistant Intakes</h3>
            <div className="list" data-testid="doctor-intake-records-list">
              {assistantIntakes.length === 0 ? (
                <div className="list-item">
                  <SmallMeta>No assistant intakes loaded yet.</SmallMeta>
                </div>
              ) : (
                assistantIntakes.map((i) => (
                  <div className="list-item" key={i.id} data-testid="doctor-intake-record-item">
                    <strong>{i.full_name || "(Unnamed patient)"}</strong>
                    <SmallMeta>DOB: {i.date_of_birth || "-"}</SmallMeta>
                    <SmallMeta>Chief complaint: {i.chief_complaint || "-"}</SmallMeta>
                    <SmallMeta>{i.created_at}</SmallMeta>
                    <div className="toolbar">
                      <button
                        className="btn"
                        data-testid={`doctor-append-intake-${i.id}`}
                        onClick={() => void appendAssistantIntakeToNote(i.id)}
                      >
                        Append Intake to Note
                      </button>
                      <button
                        className="btn primary"
                        data-testid={`doctor-open-analyze-intake-${i.id}`}
                        onClick={() => openAssistantIntakeAndAnalyze(i.id)}
                      >
                        Open + Analyze
                      </button>
                      <button
                        className="btn"
                        data-testid={`doctor-open-intake-pdf-${i.id}`}
                        onClick={() => openAssistantIntakePdf(i.id)}
                      >
                        Open intake PDF
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </Panel>

      {documentViewer ? (
        <div
          className="doc-modal-backdrop"
          data-testid="doctor-document-modal"
          onClick={() => setDocumentViewer(null)}
        >
          <div className="doc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="doc-modal-header">
              <strong>{documentViewer.title}</strong>
              <div className="toolbar">
                <button
                  className="btn primary"
                  data-testid="doctor-document-print"
                  onClick={printActiveDocument}
                >
                  Print
                </button>
                <button
                  className="btn"
                  data-testid="doctor-document-open-new-tab"
                  onClick={openDocumentInNewTab}
                >
                  View in browser tab
                </button>
                <button
                  className="btn danger"
                  data-testid="doctor-document-close-viewer"
                  onClick={() => setDocumentViewer(null)}
                >
                  Close
                </button>
              </div>
            </div>
            <iframe
              ref={documentViewerRef}
              src={documentViewer.url}
              title={documentViewer.title}
              style={{
                width: "100%",
                minHeight: "70vh",
                border: "1px solid rgba(16, 32, 25, 0.14)",
                borderRadius: 12,
                background: "white",
              }}
            />
            <SmallMeta>
              If preview is blocked by browser/PDF plugin, click &quot;View in browser tab&quot; then print there.
            </SmallMeta>
          </div>
        </div>
      ) : null}
    </main>
  );
}
