import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Bounded package: existing UI cases, the 15.png seed pair, and image10 in two viewports.
export default defineConfig({
  ...base,
  testIgnore: [],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  globalTimeout: 350_000,
  maxFailures: 1,
  globalSetup: "./e2e/support/markerRuntimeSetup.ts",
  testMatch: ["freehand-mobile-regression.spec.ts", "controlled-marker-color-difference-real-sample.spec.ts", "controlled-marker-image10.spec.ts"],
  grep: /desktop workflow keeps|visibility-limited saved draft|mobile freehand exits|aligns 15-dark-skin-holdout-chin|completeness repair covers image10/,
  outputDir: "test-results/marker-v035",
  use: { ...base.use, baseURL: "http://127.0.0.1:4175", headless: true },
  webServer: {
    command: "npm run dev:marker-v035 -- --port 4175",
    url: "http://127.0.0.1:4175/__runtime-identity.json",
    // Existing services still pass globalSetup's source/profile/browser checks.
    reuseExistingServer: true,
    timeout: 120_000,
    env: { VITE_CONTROLLED_MARKER_DETECTOR_DIAGNOSTICS: "1" },
  },
});
