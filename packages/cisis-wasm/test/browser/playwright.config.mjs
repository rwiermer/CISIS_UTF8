import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { devices } from "@playwright/test";

const directory = dirname(fileURLToPath(import.meta.url));

export default {
  testDir: directory,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4391",
    headless: true,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 15"], browserName: "webkit" },
    },
  ],
  webServer: {
    command: "node tests/browser/server.mjs",
    cwd: resolve(directory, "../../../.."),
    port: 4391,
    reuseExistingServer: false,
    timeout: 10_000,
  },
};
