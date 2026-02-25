import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";

const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408996360600000000400010be7029d0000000049454e44ae426082",
  "hex",
);

test("assistant workflow: fill intake, upload lab image, generate and save, load recent", async ({
  page,
}, testInfo) => {
  const uniqueName = `PW Assistant ${Date.now()}`;
  const labPath = testInfo.outputPath("lab1.png");
  await fs.writeFile(labPath, TINY_PNG);

  await page.goto("/assistant");
  await expect(page.getByTestId("assistant-page")).toBeVisible();

  await page.getByTestId("assistant-FullName").fill(uniqueName);
  await page.getByTestId("assistant-DateOfBirth").fill("1990-01-02");
  await page.getByTestId("assistant-Gender").fill("Male");
  await page.getByTestId("assistant-PhoneNumber").fill("555-000-0000");
  await page.getByTestId("assistant-BloodPressure").fill("120/80");
  await page.getByTestId("assistant-HeartRate").fill("72");
  await page.getByTestId("assistant-ChiefComplaint").fill(
    "Headache with mild nausea for 2 days",
  );

  await page.getByTestId("assistant-lab-upload-1").setInputFiles(labPath);
  await expect(page.getByTestId("assistant-status")).toContainText(
    "Lab image 1 uploaded",
  );
  await expect(page.getByTestId("assistant-lab-text-1")).not.toHaveValue("");

  await page.getByTestId("assistant-generate-enhanced").click();
  await expect(page.getByTestId("assistant-status")).toContainText(
    "Enhanced report generated.",
  );
  await expect(page.getByTestId("assistant-enhanced-report")).not.toContainText(
    "Enhanced report output will appear here.",
  );

  await page.getByTestId("assistant-save-intake").click();

  await page.getByTestId("assistant-refresh-records").click();
  const recordItem = page
    .getByTestId("assistant-recent-item")
    .filter({ hasText: uniqueName })
    .first();
  await expect(recordItem).toBeVisible();
  await recordItem.getByRole("button", { name: "Load into form" }).click();
  await expect(page.getByTestId("assistant-status")).toContainText("Loaded intake");
  await expect(page.getByTestId("assistant-FullName")).toHaveValue(uniqueName);
});
