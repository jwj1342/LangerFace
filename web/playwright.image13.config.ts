import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testIgnore: [],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  globalTimeout: 240_000,
  maxFailures: 1,
  testMatch: ["controlled-marker-image13.spec.ts"],
  outputDir: "test-results/image13-v035",
  use: { ...base.use, baseURL: "http://127.0.0.1:4176", headless: true },
  webServer: {
    command: "npm run dev:marker-v035 -- --port 4176",
    url: "http://127.0.0.1:4176/__runtime-identity.json",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_CONTROLLED_MARKER_DETECTOR_DIAGNOSTICS: "1" },
  },
});
