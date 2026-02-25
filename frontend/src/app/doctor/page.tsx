"use client";

import { Panel, SmallMeta } from "@/components/ui";
import { getJson, postJson, postMultipart } from "@/lib/api";
import type {
  ChatMessage,
  KbDocument,
  PatientRecordListItem,
} from "@/lib/types";
import Link from "next/link";
import { useState, useTransition } from "react";

const reviseSystemPrompt =
  "You are an expert medical scribe. Rewrite the doctor's note as a formal structured medical report. Keep every fact and measurement. Do not omit or invent information. If uncertain, preserve the original wording.";

export default function DoctorPage() {
  const [doctorNote, setDoctorNote] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [status, setStatus] = useState("Ready.");
  const [error, setError] = useState("");
  const [busy, startBusy] = useTransition();

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "CoPilot Symptomatologist web chat is ready. Ask about the current case or request a rewrite/summary.",
    },
  ]);
  const [chatInput, setChatInput] = useState("");

  const [records, setRecords] = useState<PatientRecordListItem[]>([]);
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

  const setUiError = (e: unknown, fallback: string) => {
    setError(e instanceof Error ? e.message : fallback);
  };

  const appendToNote = (text: string) => {
    setDoctorNote((prev) => `${prev}${prev.trim() ? "\n\n" : ""}${text}`.trim());
  };

  const refreshPatientRecords = async () => {
    setError("");
    setStatus("Loading patient records...");
    try {
      const resp = await getJson<{ items: PatientRecordListItem[] }>("/patient_records");
      setRecords(resp.items ?? []);
      setStatus(`Loaded ${resp.items?.length ?? 0} patient record(s).`);
    } catch (e) {
      setUiError(e, "Failed to load patient records.");
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

  const handleAnalyze = () => {
    setError("");
    setStatus("Analyzing case...");
    startBusy(async () => {
      try {
        const refNames = kbDocs
          .filter((d) => (d.tags ?? []).every((t) => t !== "patient-record"))
          .slice(0, 5)
          .map((d) => d.filename);
        const resp = await postJson<{ analysis: string }>("/analyze_case", {
          note: doctorNote,
          reference_names: refNames,
        });
        setAnalysis(resp.analysis ?? "");
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

  return (
    <main className="shell stack" data-testid="doctor-page">
      <section className="hero">
        <h1>Medical Doctor Workspace</h1>
        <p>
          Web replacement for the desktop doctor portal: attachments, note
          revision, AI chat, case analysis, local reference KB, medical
          references search, medication lookup, and patient record persistence.
        </p>
        <nav className="hero-nav">
          <Link href="/">Home</Link>
          <Link href="/assistant">Assistant Portal</Link>
          <button
            className="btn ghost"
            data-testid="doctor-refresh-kb"
            onClick={() => void refreshKb()}
          >
            Refresh KB
          </button>
          <button
            className="btn ghost"
            data-testid="doctor-refresh-patient-records"
            onClick={() => void refreshPatientRecords()}
          >
            Refresh patient records
          </button>
        </nav>
      </section>

      <div className={`status${error ? " error" : ""}`} data-testid="doctor-status">
        {error || status}
      </div>

      <div className="page-grid columns-2">
        <Panel title="Doctor Note" subtitle="Main case narrative workspace">
          <div className="toolbar">
            <label className="btn" data-testid="doctor-attach-file-label">
              Attach file (PDF/Text/Image)
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
            <button
              className="btn accent"
              data-testid="doctor-revise-report"
              disabled={busy}
              onClick={handleRevise}
            >
              Revise Report
            </button>
            <button
              className="btn primary"
              data-testid="doctor-analyze-case"
              disabled={busy}
              onClick={handleAnalyze}
            >
              Analyze Case
            </button>
            <button
              className="btn"
              data-testid="doctor-save-patient-record"
              disabled={busy}
              onClick={handleSavePatientRecord}
            >
              Save Patient Record
            </button>
            <button className="btn" data-testid="doctor-clear-note" onClick={() => setDoctorNote("")}>
              Clear
            </button>
          </div>
          <textarea
            data-testid="doctor-note"
            value={doctorNote}
            onChange={(e) => setDoctorNote(e.target.value)}
            placeholder="Paste or dictate doctor note here..."
            style={{ minHeight: 360, marginTop: 12 }}
          />
        </Panel>

        <Panel title="AI Analysis" subtitle="Output from /analyze_case">
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

      <Panel title="Saved Patient Records" subtitle="Created from doctor note and indexed in local KB">
        <div className="list" data-testid="doctor-patient-records-list">
          {records.length === 0 ? (
            <div className="list-item">
              <SmallMeta>No patient records loaded yet.</SmallMeta>
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
      </Panel>
    </main>
  );
}
