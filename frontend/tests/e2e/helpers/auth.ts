import { expect, type Page } from "@playwright/test";

const ASSISTANT_PIN = "assistant123";
const DOCTOR_PIN = "docbayson888#";

async function loginWithPins(
  page: Page,
  role: "assistant" | "doctor",
  pins: string[],
): Promise<void> {
  const buttonTestId = role === "assistant" ? "login-as-assistant" : "login-as-doctor";
  const targetUrl = role === "assistant" ? /\/assistant\/?$/ : /\/doctor\/?$/;
  await page.goto(`/login/?next=${role}`);
  await expect(page.getByTestId("login-page")).toBeVisible();

  let lastError = "";
  for (const pin of pins) {
    const loginRespPromise = page.waitForResponse((resp) => {
      return resp.url().includes("/auth/login") && resp.request().method() === "POST";
    });
    await page.getByTestId("login-pin-input").fill(pin);
    await page.getByTestId(buttonTestId).click();
    const loginResp = await loginRespPromise;
    const status = loginResp.status();
    if (status >= 400) {
      try {
        const body = (await loginResp.json()) as { detail?: unknown };
        lastError = `HTTP ${status}: ${String(body?.detail || "")}`;
      } catch {
        lastError = `HTTP ${status}`;
      }
      continue;
    }
    try {
      await expect(page).toHaveURL(targetUrl, { timeout: 8000 });
      return;
    } catch {
      lastError = "Login response was successful, but portal redirect did not complete.";
    }
  }
  throw new Error(`Unable to login as ${role}. ${lastError}`);
}

export async function loginAsAssistant(page: Page): Promise<void> {
  await loginWithPins(page, "assistant", [ASSISTANT_PIN]);
}

export async function loginAsDoctor(page: Page): Promise<void> {
  await loginWithPins(page, "doctor", [DOCTOR_PIN]);
}
