import { expect, test } from "@playwright/test";

test("runs the interactive playground workflows", async ({ page }) => {
  await page.goto("/build/pages/index.html");
  await page.waitForFunction(
    () => window.__cisisPlaygroundReady || window.__cisisPlaygroundError,
  );

  const startupError = await page.evaluate(() => window.__cisisPlaygroundError);
  expect(startupError).toBeUndefined();
  await expect(page.locator("#runtime-label")).toHaveText("Runtime ready");
  await expect(page.locator("#record-list .record-item")).toHaveCount(4);

  await page.locator("#run-button").click();
  await expect(page.locator("#output-status")).toHaveText("Completed");
  await expect(page.locator("#console")).toContainText("The climate archive");
  await expect(page.locator("#console")).toContainText("Maya Okafor; Lucía Santos");

  await page.getByRole("tab", { name: "FST + Search" }).click();
  await page.locator("#run-button").click();
  await expect(page.locator("#output-status")).toHaveText("Completed");
  await expect(page.locator("#console")).toContainText("The climate archive");

  await page.getByRole("tab", { name: "WXIS" }).click();
  await page.locator("#run-button").click();
  await expect(page.locator("#output-status")).toHaveText("Completed");
  await expect(page.locator("#console")).toContainText("Hello, browser");
  await expect(page.locator("#console")).toContainText("Iteration 3 of 3");

  await page.getByRole("tab", { name: "Records" }).click();
  await page.locator("#run-button").click();
  await expect(page.locator("#output-status")).toHaveText("Completed");
  await expect(page.locator("#console")).toContainText('"mfn": 4');

  await page.getByRole("tab", { name: "MX", exact: true }).click();
  await page.locator("#run-button").click();
  await expect(page.locator("#output-status")).toHaveText("Completed");
  await expect(page.locator("#console")).toContainText("001|The climate archive");

  const overflowsViewport = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflowsViewport).toBe(false);
});
