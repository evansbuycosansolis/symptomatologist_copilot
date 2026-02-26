import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const backendDir = path.resolve(__dirname, "../backend");
const backendVenvPython = path.resolve(
  backendDir,
  ".venv",
  "Scripts",
  "python.exe",
);
const backendPython = fs.existsSync(backendVenvPython)
  ? backendVenvPython
  : "python";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["html", { open: "never" }], ["line"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: `"${backendPython}" -m uvicorn main:app --host 127.0.0.1 --port 8080`,
      cwd: backendDir,
      url: "http://127.0.0.1:8080/health",
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        ...process.env,
        OPENAI_API_KEY: "",
        OPENAI_MODEL: "gpt-4o-mini",
        HOST: "127.0.0.1",
        PORT: "8080",
        FRONTEND_ORIGIN: "http://localhost:3000",
        AUTH_SECRET: "e2e-auth-secret",
      },
    },
    {
      command: "npm run dev -- --port 3000",
      cwd: __dirname,
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 180_000,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_BASE_URL: "http://localhost:8080",
      },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
