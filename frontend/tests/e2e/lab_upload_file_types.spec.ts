import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import { loginAsAssistant } from "./helpers/auth";

const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408996360600000000400010be7029d0000000049454e44ae426082",
  "hex",
);

test("assistant lab upload accepts pdf/image, populates text box, and persists with patient data", async ({
  page,
}, testInfo) => {
  const uniqueName = `Lab File Types ${Date.now()}`;
  const pdfText = "PDF-LAB-HbA1c 6.9%";
  const imageText = "IMG-LAB-WBC 10.2 x10^9/L";

  let uploadIndex = 0;
  await page.route("**/attachments/extract", async (route) => {
    const extractedText = uploadIndex === 0 ? pdfText : imageText;
    uploadIndex += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        extracted_text: extractedText,
        message: "",
        ocr_engine: "mock",
      }),
    });
  });

  const pdfPath = testInfo.outputPath("lab.pdf");
  const pngPath = testInfo.outputPath("lab.png");
  await fs.writeFile(pdfPath, "%PDF-1.4\n%mock\n");
  await fs.writeFile(pngPath, TINY_PNG);

  await loginAsAssistant(page);
  await expect(page.getByTestId("assistant-page")).toBeVisible();

  await page.getByTestId("assistant-FullName").fill(uniqueName);
  await page.getByTestId("assistant-DateOfBirth").fill("1991-01-01");
  await page.getByTestId("assistant-ChiefComplaint").fill("Lab upload file type validation");

  await page.getByTestId("assistant-lab-upload-1").setInputFiles(pdfPath);
  await expect(page.getByTestId("assistant-status")).toContainText("Lab file 1 uploaded");
  await expect(page.getByTestId("assistant-lab-text-1")).toHaveValue(pdfText);

  await page.getByTestId("assistant-lab-upload-2").setInputFiles(pngPath);
  await expect(page.getByTestId("assistant-status")).toContainText("Lab file 2 uploaded");
  await expect(page.getByTestId("assistant-lab-text-2")).toHaveValue(imageText);

  await page.getByTestId("assistant-save-intake").click();
  await page.getByTestId("assistant-refresh-records").click();

  const savedRecord = page
    .getByTestId("assistant-recent-item")
    .filter({ hasText: uniqueName })
    .first();
  await expect(savedRecord).toBeVisible();

  await savedRecord.getByRole("button", { name: "Open patient PDF" }).click();
  await expect(page.getByTestId("assistant-FullName")).toHaveValue(uniqueName);
  await expect(page.getByTestId("assistant-lab-text-1")).toHaveValue(pdfText);
  await expect(page.getByTestId("assistant-lab-text-2")).toHaveValue(imageText);
});
