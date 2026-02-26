import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import { loginAsAssistant } from "./helpers/auth";

const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408996360600000000400010be7029d0000000049454e44ae426082",
  "hex",
);

test("assistant uploads stay linked to the correct patient record on save and retrieval", async ({
  page,
}, testInfo) => {
  const patientA = `Image Link A ${Date.now()}`;
  const patientB = `Image Link B ${Date.now()}`;

  const aLab1 = "A-LAB-1 glucose=145 mg/dL";
  const aLab2 = "A-LAB-2 ketones=trace";
  const bLab1 = "B-LAB-1 glucose=92 mg/dL";

  const mockedExtractedTexts = [aLab1, aLab2, bLab1];
  let uploadIndex = 0;

  await page.route("**/attachments/extract", async (route) => {
    const extracted =
      mockedExtractedTexts[Math.min(uploadIndex, mockedExtractedTexts.length - 1)];
    uploadIndex += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        extracted_text: extracted,
        message: "",
        ocr_engine: "mock",
      }),
    });
  });

  const lab1Path = testInfo.outputPath("lab1.png");
  const lab2Path = testInfo.outputPath("lab2.png");
  await fs.writeFile(lab1Path, TINY_PNG);
  await fs.writeFile(lab2Path, TINY_PNG);

  await loginAsAssistant(page);
  await expect(page.getByTestId("assistant-page")).toBeVisible();

  // Patient A: upload two lab images and save.
  await page.getByTestId("assistant-FullName").fill(patientA);
  await page.getByTestId("assistant-DateOfBirth").fill("1991-01-01");
  await page.getByTestId("assistant-ChiefComplaint").fill("Patient A complaint");
  await page.getByTestId("assistant-lab-upload-1").setInputFiles(lab1Path);
  await expect(page.getByTestId("assistant-lab-text-1")).toHaveValue(aLab1);
  await page.getByTestId("assistant-lab-upload-2").setInputFiles(lab2Path);
  await expect(page.getByTestId("assistant-lab-text-2")).toHaveValue(aLab2);
  await page.getByTestId("assistant-save-intake").click();
  await page.getByTestId("assistant-refresh-records").click();
  await expect(
    page.getByTestId("assistant-recent-item").filter({ hasText: patientA }).first(),
  ).toBeVisible();

  // Patient B: clear, upload one lab image and save.
  await page.getByTestId("assistant-clear-form").click();
  await expect(page.getByTestId("assistant-FullName")).toHaveValue("");
  await page.getByTestId("assistant-FullName").fill(patientB);
  await page.getByTestId("assistant-DateOfBirth").fill("1992-02-02");
  await page.getByTestId("assistant-ChiefComplaint").fill("Patient B complaint");
  await page.getByTestId("assistant-lab-upload-1").setInputFiles(lab1Path);
  await expect(page.getByTestId("assistant-lab-text-1")).toHaveValue(bLab1);
  await page.getByTestId("assistant-save-intake").click();
  await page.getByTestId("assistant-refresh-records").click();
  await expect(
    page.getByTestId("assistant-recent-item").filter({ hasText: patientB }).first(),
  ).toBeVisible();

  // Retrieve Patient A and verify A labs are restored, not B.
  const recordA = page
    .getByTestId("assistant-recent-item")
    .filter({ hasText: patientA })
    .first();
  await expect(recordA).toBeVisible();
  await recordA.getByRole("button", { name: "Open patient PDF" }).click();
  await expect(page.getByTestId("assistant-status")).toContainText(/patient PDF/i);
  await expect(page.getByTestId("assistant-FullName")).toHaveValue(patientA);
  await expect(page.getByTestId("assistant-lab-text-1")).toHaveValue(aLab1);
  await expect(page.getByTestId("assistant-lab-text-2")).toHaveValue(aLab2);
  await expect(page.getByTestId("assistant-lab-text-1")).not.toHaveValue(bLab1);

  // Retrieve Patient B and verify B lab is restored, not A.
  const recordB = page
    .getByTestId("assistant-recent-item")
    .filter({ hasText: patientB })
    .first();
  await expect(recordB).toBeVisible();
  await recordB.getByRole("button", { name: "Open patient PDF" }).click();
  await expect(page.getByTestId("assistant-status")).toContainText(/patient PDF/i);
  await expect(page.getByTestId("assistant-FullName")).toHaveValue(patientB);
  await expect(page.getByTestId("assistant-lab-text-1")).toHaveValue(bLab1);
  await expect(page.getByTestId("assistant-lab-text-1")).not.toHaveValue(aLab1);
});
