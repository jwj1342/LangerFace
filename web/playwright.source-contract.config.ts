import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: "freehand-mobile-regression.spec.ts",
  grep: /@source-contract/,
  grepInvert: undefined,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  projects: base.projects?.map(project => ({ ...project, name: "source-contract" })),
  use: { ...base.use, baseURL: "http://127.0.0.1:4174" },
  webServer: {
    command: "npm run dev -- --port 4174 --strictPort",
    url: "http://127.0.0.1:4174/__runtime-identity.json",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
