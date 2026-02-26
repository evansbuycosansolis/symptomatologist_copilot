import { expect, test } from "@playwright/test";
import { loginAsAssistant, loginAsDoctor } from "./helpers/auth";

test("assistant cannot access doctor workspace by URL forcing, localStorage tampering, or doctor APIs", async ({
  page,
}) => {
  await loginAsAssistant(page);
  await expect(page.getByTestId("assistant-page")).toBeVisible();

  // Attempt 0: logged-in assistant should be redirected away from login page.
  await page.goto("/login/?next=doctor");
  await expect(page.getByTestId("assistant-page")).toBeVisible();
  await expect(page).toHaveURL(/\/assistant\/?$/);

  // Attempt 1: direct navigation to doctor URL.
  await page.goto("/doctor");
  await expect(page.getByTestId("assistant-page")).toBeVisible();
  await expect(page.getByTestId("assistant-status")).toContainText(
    "Doctor workspace is restricted",
  );
  await expect(page).not.toHaveURL(/\/doctor\/?$/);

  // Attempt 2: localStorage role tampering should not bypass backend session role.
  await page.evaluate(() => {
    window.localStorage.setItem("copilot.portal.role", "doctor");
  });
  await page.goto("/doctor");
  await expect(page.getByTestId("assistant-page")).toBeVisible();
  await expect(page).not.toHaveURL(/\/doctor\/?$/);

  // Attempt 3: direct call to doctor-only API should return 403.
  const analyzeResp = await page.context().request.post("http://localhost:8080/analyze_case", {
    data: { note: "Exploit test", reference_names: [] },
  });
  const analyzeBody = (await analyzeResp.json().catch(() => ({}))) as { detail?: unknown };
  expect(analyzeResp.status()).toBe(403);
  expect(String(analyzeBody?.detail || "")).toContain("Doctor access required");
});

test("doctor can access both portals while unauthenticated users are redirected from doctor workspace", async ({
  page,
}) => {
  await page.goto("/doctor");
  await expect(page).toHaveURL(/\/login\/\?next=doctor/);

  await loginAsDoctor(page);
  await expect(page.getByTestId("doctor-page")).toBeVisible();

  await page.goto("/assistant");
  await expect(page.getByTestId("assistant-page")).toBeVisible();
});
