import { defineConfig, devices } from "@playwright/test";

const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: [
    "**/controlled-marker-color-difference-real-sample.spec.ts",
    "**/controlled-marker-image10.spec.ts",
    "**/controlled-marker-image13.spec.ts",
  ],
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  // 真实 WebGL/模型用例在 CI 共享同一渲染主机；串行调度，不放宽断言或超时。
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "line",
  outputDir: "test-results/playwright",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: chromiumExecutablePath
          ? { executablePath: chromiumExecutablePath }
          : undefined,
      },
    },
  ],
  webServer: {
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/app/incision",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
