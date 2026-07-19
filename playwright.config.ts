import { defineConfig, devices } from "@playwright/test";

import { resolvePlaywrightTarget } from "./scripts/playwright-target";

const target = resolvePlaywrightTarget();

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  outputDir: "test-results/e2e",
  expect: { timeout: 10_000 },
  use: {
    baseURL: target.baseURL,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 1_440, height: 900 },
    },
  }],
  webServer: target.external ? undefined : {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${target.port}`,
    url: target.baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
