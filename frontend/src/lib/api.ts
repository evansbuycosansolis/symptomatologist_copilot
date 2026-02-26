import type { ChatMessage, PatientIntakeData } from "@/lib/types";

function computeApiBase(): string {
  const envBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "").trim();
  if (envBase) return envBase.replace(/\/+$/, "");

  if (typeof window !== "undefined" && window.location?.origin) {
    const origin = window.location.origin;
    const isLikelyNextDev =
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
      window.location.port === "3000";
    return isLikelyNextDev ? "http://127.0.0.1:8080" : origin;
  }

  return "http://127.0.0.1:8080";
}

const API_BASE = computeApiBase();

async function parseResponse<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let detail = `${resp.status} ${resp.statusText}`;
    try {
      const body = await resp.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  return (await resp.json()) as T;
}

export async function getJson<T>(path: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  return parseResponse<T>(resp);
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(resp);
}

export async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(resp);
}

export async function postMultipart<T>(
  path: string,
  form: FormData,
): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    body: form,
  });
  return parseResponse<T>(resp);
}

export const api = {
  baseUrl: API_BASE,
  health: () => getJson<{ status: string; time: string }>("/health"),
  chat: (history: ChatMessage[]) => postJson<{ reply: string }>("/chat", { history }),
  enhancePatientReport: (intake: PatientIntakeData) =>
    postJson<{ enhanced_report: string }>("/enhance-patient-report", intake),
  saveIntake: (intake: PatientIntakeData, generateEnhancedReport = true) =>
    postJson<{ record: unknown; enhanced_report: string }>("/intakes", {
      intake,
      generate_enhanced_report: generateEnhancedReport,
    }),
};

