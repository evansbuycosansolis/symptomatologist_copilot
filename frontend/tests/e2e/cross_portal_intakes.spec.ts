import { expect, test } from "@playwright/test";

test("doctor can retrieve assistant intakes", async ({ page }) => {
  const uniqueName = `E2E Intake Visible ${Date.now()}`;

  await page.goto("/assistant");
  await expect(page.getByTestId("assistant-page")).toBeVisible();
  await page.getByTestId("assistant-FullName").fill(uniqueName);
  await page.getByTestId("assistant-DateOfBirth").fill("1992-04-15");
  await page.getByTestId("assistant-ChiefComplaint").fill(
    "Cross-portal intake retrieval check",
  );
  await page.getByTestId("assistant-save-intake").click();
  await page.getByTestId("assistant-refresh-records").click();
  await expect(page.getByTestId("assistant-recent-list")).toContainText(
    uniqueName,
  );

  await page.goto("/doctor");
  await expect(page.getByTestId("doctor-page")).toBeVisible();
  await page.getByTestId("doctor-refresh-patient-records").click();

  const intakeItem = page
    .getByTestId("doctor-intake-record-item")
    .filter({ hasText: uniqueName })
    .first();
  await expect(intakeItem).toBeVisible();
  await intakeItem
    .getByRole("button", { name: "Append Intake to Note" })
    .click();
  await expect(page.getByTestId("doctor-note")).toContainText(uniqueName);

  await intakeItem
    .getByRole("button", { name: "Open + Analyze" })
    .click();
  await expect(page.getByTestId("doctor-status")).toContainText(
    "completed AI analysis",
  );
  await expect(page.getByTestId("doctor-analysis-output")).not.toContainText(
    "Case analysis output will appear here.",
  );
});
