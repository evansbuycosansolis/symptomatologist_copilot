"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ensureFreshLoginState,
  fetchPortalSession,
  loginPortal,
  logoutPortal,
  nextPortalPath,
  type PortalRole,
} from "@/lib/portal-auth";

export default function LoginPage() {
  const router = useRouter();
  const [requested, setRequested] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [authError, setAuthError] = useState("");
  const [busyRole, setBusyRole] = useState<PortalRole | null>(null);
  const [currentRole, setCurrentRole] = useState<PortalRole | null>(null);
  const pinInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (typeof window === "undefined") return;
    void (async () => {
      const query = new URLSearchParams(window.location.search);
      const nextRequested = query.get("next");
      const blockedRole = query.get("blocked");
      const freshRaw = (query.get("fresh") || "").trim().toLowerCase();
      const forceFresh = freshRaw === "1" || freshRaw === "true" || freshRaw === "yes";

      setRequested(nextRequested);
      setBlocked(blockedRole);

      await ensureFreshLoginState({ force: forceFresh });

      if (forceFresh && !cancelled) {
        const cleaned = new URLSearchParams(query);
        cleaned.delete("fresh");
        const nextUrl = cleaned.toString() ? `/login/?${cleaned}` : "/login/";
        window.history.replaceState(null, "", nextUrl);
      }

      const role = await fetchPortalSession();
      if (cancelled) return;
      if (role) {
        router.replace(nextPortalPath(role, nextRequested));
        return;
      }
      setCurrentRole(role);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const helperText = useMemo(() => {
    if (blocked === "doctor") {
      return "Doctor workspace is restricted for assistant accounts.";
    }
    if (requested === "doctor") {
      return "Sign in as Doctor to open Medical Doctor Workspace.";
    }
    if (requested === "assistant") {
      return "Sign in to continue to Medical Assistant Portal.";
    }
    return "Select your portal access role.";
  }, [blocked, requested]);

  const loginAs = (role: PortalRole) => {
    setAuthError("");
    setBusyRole(role);
    const enteredPin = (pinInputRef.current?.value ?? pin).trim();
    void (async () => {
      try {
        const resolvedRole = await loginPortal(role, enteredPin);
        setCurrentRole(resolvedRole);
        router.replace(nextPortalPath(resolvedRole, requested));
      } catch (e) {
        setAuthError(e instanceof Error ? e.message : "Login failed.");
      } finally {
        setBusyRole(null);
      }
    })();
  };

  const logout = () => {
    setAuthError("");
    setBusyRole("assistant");
    void (async () => {
      try {
        await logoutPortal();
        setCurrentRole(null);
        if (typeof window !== "undefined") {
          window.history.replaceState(null, "", "/login/");
        }
      } catch (e) {
        setAuthError(e instanceof Error ? e.message : "Logout failed.");
      } finally {
        setBusyRole(null);
      }
    })();
  };

  return (
    <main className="shell stack" data-testid="login-page">
      <section className="hero">
        <h1 className="doctor-hero-title">Portal Login</h1>
        <p>{helperText}</p>
        <nav className="hero-nav">
          <Link href="/">Home</Link>
          <Link href="/assistant">Assistant</Link>
          <Link href="/doctor">Doctor</Link>
        </nav>
      </section>

      <section className="panel stack">
        <div className="field" style={{ maxWidth: 360 }}>
          <label htmlFor="loginPin">PIN</label>
          <input
            id="loginPin"
            data-testid="login-pin-input"
            type="password"
            ref={pinInputRef}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Enter role PIN"
          />
        </div>
        <div className="toolbar">
          <button
            className="btn primary"
            data-testid="login-as-assistant"
            disabled={busyRole !== null}
            onClick={() => loginAs("assistant")}
          >
            {busyRole === "assistant" ? "Logging in..." : "Login as Medical Assistant"}
          </button>
          <button
            className="btn accent"
            data-testid="login-as-doctor"
            disabled={busyRole !== null}
            onClick={() => loginAs("doctor")}
          >
            {busyRole === "doctor" ? "Logging in..." : "Login as Doctor"}
          </button>
          <button
            className="btn ghost"
            data-testid="login-clear-session"
            disabled={busyRole !== null}
            onClick={logout}
          >
            Clear session
          </button>
        </div>
        {authError ? (
          <p className="small-meta" data-testid="login-error" style={{ color: "#a11818" }}>
            {authError}
          </p>
        ) : null}
        <p className="small-meta" data-testid="login-current-role">
          Current role: {currentRole ? currentRole : "none"}
        </p>
      </section>
    </main>
  );
}
