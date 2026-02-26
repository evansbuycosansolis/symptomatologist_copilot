import { getJson, postJson } from "@/lib/api";

export type PortalRole = "doctor" | "assistant";

const PORTAL_ROLE_KEY = "copilot.portal.role";
const PORTAL_LOGIN_AT_KEY = "copilot.portal.login_at";
const PORTAL_BOOT_CLEANED_KEY = "copilot.portal.boot_cleaned";

function isPortalRole(value: unknown): value is PortalRole {
  return value === "doctor" || value === "assistant";
}

export function getPortalRole(): PortalRole | null {
  if (typeof window === "undefined") return null;
  const raw = (window.localStorage.getItem(PORTAL_ROLE_KEY) || "").trim().toLowerCase();
  return isPortalRole(raw) ? raw : null;
}

export function setPortalRole(role: PortalRole): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PORTAL_ROLE_KEY, role);
  window.localStorage.setItem(PORTAL_LOGIN_AT_KEY, new Date().toISOString());
}

export function clearPortalRole(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PORTAL_ROLE_KEY);
  window.localStorage.removeItem(PORTAL_LOGIN_AT_KEY);
}

function clearPortalClientState(): void {
  if (typeof window === "undefined") return;
  clearPortalRole();
}

export function nextPortalPath(role: PortalRole, requested: string | null | undefined): string {
  const target = (requested || "").toLowerCase().replace(/[^a-z]/g, "");
  if (target === "doctor") {
    return role === "doctor" ? "/doctor/" : "/assistant/";
  }
  if (target === "assistant") {
    return "/assistant/";
  }
  return role === "doctor" ? "/doctor/" : "/assistant/";
}

export async function fetchPortalSession(): Promise<PortalRole | null> {
  try {
    const resp = await getJson<{ authenticated?: boolean; role?: string | null }>("/auth/session");
    const role = isPortalRole(resp?.role) ? resp.role : null;
    if (resp?.authenticated && role) {
      setPortalRole(role);
      return role;
    }
    clearPortalRole();
    return null;
  } catch {
    clearPortalRole();
    return null;
  }
}

export async function loginPortal(role: PortalRole, pin: string): Promise<PortalRole> {
  const resp = await postJson<{ authenticated?: boolean; role?: string | null }>(
    "/auth/login",
    { role, pin },
  );
  const resolved = isPortalRole(resp?.role) ? resp.role : null;
  if (!resp?.authenticated || !resolved) {
    throw new Error("Login failed.");
  }
  setPortalRole(resolved);
  return resolved;
}

export async function ensureFreshLoginState(options?: { force?: boolean }): Promise<void> {
  if (typeof window === "undefined") return;
  const force = Boolean(options?.force);
  const alreadyCleaned = window.sessionStorage.getItem(PORTAL_BOOT_CLEANED_KEY) === "1";
  if (!force && alreadyCleaned) return;
  window.sessionStorage.setItem(PORTAL_BOOT_CLEANED_KEY, "1");
  try {
    await postJson("/auth/logout", {});
  } finally {
    clearPortalClientState();
  }
}

export async function logoutPortal(): Promise<void> {
  try {
    await postJson("/auth/logout", {});
  } finally {
    clearPortalClientState();
  }
}
