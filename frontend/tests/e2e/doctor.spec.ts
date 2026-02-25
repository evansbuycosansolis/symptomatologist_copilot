import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";

test("doctor workflow: attachments, chat, analysis, patient record, kb train/ask, mocked external lookups", async ({
  page,
}, testInfo) => {
  // Mock external-dependency-backed routes for deterministic UI assertions.
  await page.route("**/rxnav_lookup*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        query: "metformin",
        items: ["Metformin 500 MG Oral Tablet", "Metformin ER 500 MG Oral Tablet"],
      }),
    });
  });
  await page.route("**/medical_references", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        query: "migraine management",
        summary_text: "Mocked evidence summary for migraine management.",
        report_text:
          "MEDICAL REFERENCES REPORT\n\nQuery: migraine management\n\nPUBMED\n1. Mock Article\n   PMID123\n",
        pubmed: [],
        clinical_trials: [],
        rxnorm: [],
        errors: [],
      }),
    });
  });

  const attachPath = testInfo.outputPath("attachment.txt");
  const trainPath = testInfo.outputPath("kb_ref.txt");
  await fs.writeFile(
    attachPath,
    "Patient note attachment text\\nSymptoms include fever and cough.",
  );
  await fs.writeFile(
    trainPath,
    "Migraine red flags include sudden onset thunderclap headache and focal neurological deficits.",
  );

  await page.goto("/doctor");
  await expect(page.getByTestId("doctor-page")).toBeVisible();

  await page.getByTestId("doctor-attach-file-input").setInputFiles(attachPath);
  await expect(page.getByTestId("doctor-status")).toContainText(
    "Attachment processed",
  );
  await expect(page.getByTestId("doctor-note")).toContainText("Symptoms include fever and cough");

  await page.getByTestId("doctor-chat-input").fill("Summarize this case in one line.");
  await page.getByTestId("doctor-chat-send").click();
  await expect(page.getByTestId("doctor-status")).toContainText("Chat reply received.");
  await expect(page.getByTestId("doctor-chat-box")).toContainText("user:");
  await expect(page.getByTestId("doctor-chat-box")).toContainText("assistant:");

  await page.getByTestId("doctor-analyze-case").click();
  await expect(page.getByTestId("doctor-status")).toContainText("Case analysis complete.");
  await expect(page.getByTestId("doctor-analysis-output")).not.toContainText(
    "Case analysis output will appear here.",
  );

  await page.getByTestId("doctor-save-patient-record").click();
  await page.getByTestId("doctor-refresh-patient-records").click();
  await expect(page.getByTestId("doctor-patient-record-item").first()).toBeVisible();
  await expect(page.getByTestId("doctor-patient-records-list")).toContainText(".txt");

  await page.getByTestId("doctor-train-tags").fill("Neuro,Playwright");
  await page.getByTestId("doctor-train-upload-input").setInputFiles(trainPath);

  await page.getByTestId("doctor-refresh-kb-list").click();

  const kbSelect = page.getByTestId("doctor-kb-select");
  await expect(kbSelect).toBeVisible();
  const optionCount = await kbSelect.locator("option").count();
  expect(optionCount).toBeGreaterThan(1);
  await kbSelect.selectOption({ index: optionCount - 1 });
  await page.getByTestId("doctor-kb-question").fill("What red flags are mentioned?");
  await page.getByTestId("doctor-kb-ask").click();
  await expect(page.getByTestId("doctor-kb-answer")).not.toContainText(
    "KB answer output will appear here.",
  );

  await page.getByTestId("doctor-rx-query").fill("metformin");
  await page.getByTestId("doctor-rx-lookup").click();
  await expect(page.getByTestId("doctor-rx-results")).toContainText(
    "Metformin 500 MG Oral Tablet",
  );

  await page.getByTestId("doctor-ref-query").fill("migraine management");
  await page.getByTestId("doctor-ref-fetch").click();
  await expect(page.getByTestId("doctor-ref-summary")).toContainText(
    "Mocked evidence summary",
  );
  await expect(page.getByTestId("doctor-ref-report")).toContainText(
    "MEDICAL REFERENCES REPORT",
  );
});
