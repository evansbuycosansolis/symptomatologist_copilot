"use client";

import { Panel, SmallMeta } from "@/components/ui";
import { getJson, postJson, postMultipart } from "@/lib/api";
import { emptyIntake, type IntakeListItem, type PatientIntakeData } from "@/lib/types";
import Link from "next/link";
import { startTransition, useState, useTransition } from "react";

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
  const [intake, setIntake] = useState<PatientIntakeData>(emptyIntake);
  const [enhancedReport, setEnhancedReport] = useState("");
  const [recent, setRecent] = useState<IntakeListItem[]>([]);
  const [status, setStatus] = useState("Ready.");
  const [error, setError] = useState("");
  const [isBusy, startBusy] = useTransition();
  const [labUploadBusy, setLabUploadBusy] = useState<number | null>(null);
  const [listBusy, setListBusy] = useState(false);

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

  const loadIntake = async (id: string) => {
    setError("");
    setStatus(`Loading record ${id}...`);
    try {
      const data = await getJson<{
        intake: PatientIntakeData;
        enhanced_report?: string;
      }>(`/intakes/${id}`);
      setIntake({ ...emptyIntake, ...(data.intake ?? {}) });
      setEnhancedReport(data.enhanced_report ?? "");
      setStatus(`Loaded intake ${id}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load intake.");
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

  const uploadLabImage = async (slot: number, file: File) => {
    setLabUploadBusy(slot);
    setError("");
    setStatus(`Uploading lab image ${slot}...`);
    try {
      const form = new FormData();
      form.append("file", file);
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
          ? `Lab image ${slot} uploaded and text extracted.`
          : `Lab image ${slot} uploaded.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lab upload failed.");
    } finally {
      setLabUploadBusy(null);
    }
  };

  return (
    <main className="shell stack" data-testid="assistant-page">
      <section className="hero">
        <h1>Medical Assistant Portal</h1>
        <p>
          Structured patient intake capture mapped to the original WinForms
          fields, plus lab-image upload (optional text extraction), AI-enhanced
          intake summary generation, and saved record retrieval.
        </p>
        <nav className="hero-nav">
          <Link href="/">Home</Link>
          <Link href="/doctor">Doctor Workspace</Link>
          <button
            className="btn ghost"
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
        <Panel title="Lab Results (1-6)" subtitle="Upload image or paste extracted text manually">
          <div className="stack">
            {labKeys.map((key, idx) => (
              <div className="panel" key={key} style={{ padding: "0.75rem" }}>
                <div className="toolbar" style={{ justifyContent: "space-between" }}>
                  <strong>Lab Result {idx + 1}</strong>
                  <label className="btn ghost" style={{ cursor: "pointer" }}>
                    {labUploadBusy === idx + 1 ? "Uploading..." : "Upload image"}
                    <input
                      type="file"
                      data-testid={`assistant-lab-upload-${idx + 1}`}
                      accept="image/*"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadLabImage(idx + 1, file);
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
                  onClick={() => void loadIntake(item.id)}
                >
                  Load into form
                </button>
              </div>
            ))
          )}
        </div>
      </Panel>
    </main>
  );
}
