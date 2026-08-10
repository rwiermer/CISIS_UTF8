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
  await expect(page.locator("#pft-example option")).toHaveCount(4);
  await expect(page.locator("#search-example option")).toHaveCount(4);
  await expect(page.locator("#wxis-example option")).toHaveCount(3);
  await expect(page.locator("#records-example option")).toHaveCount(3);
  await expect(page.locator("#fdt-example option")).toHaveCount(3);
  await expect(page.locator("#mx-example option")).toHaveCount(3);

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

  await page.getByRole("tab", { name: "FDT", exact: true }).click();
  await page.locator("#run-button").click();
  await expect(page.locator("#output-status")).toHaveText("Completed");
  await expect(page.locator("#console")).toContainText('"valid": true');
  await expect(page.locator("#field-key span")).toHaveCount(5);

  await page.getByRole("tab", { name: "MX", exact: true }).click();
  await page.locator("#run-button").click();
  await expect(page.locator("#output-status")).toHaveText("Completed");
  await expect(page.locator("#console")).toContainText("001|The climate archive");

  const overflowsViewport = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflowsViewport).toBe(false);
});

test("loads and runs alternate playground examples", async ({ page }) => {
  await page.goto("/build/pages/index.html");
  await page.waitForFunction(() => window.__cisisPlaygroundReady);

  await page.locator("#pft-example").selectOption({ label: "Imprint subfields" });
  await page.locator("#run-button").click();
  await expect(page.locator("#console")).toContainText("Amsterdam : Open Archive Press");

  await page.getByRole("tab", { name: "FST + Search" }).click();
  await page.locator("#search-example").selectOption({ label: "Author words" });
  await page.locator("#run-button").click();
  await expect(page.locator("#output-status")).toHaveText("Completed");
  await expect(page.locator("#console")).toContainText("Aiko Tanaka");

  await page.getByRole("tab", { name: "WXIS" }).click();
  await page.locator("#wxis-example").selectOption({ label: "Database range" });
  await page.locator("#run-button").click();
  await expect(page.locator("#output-status")).toHaveText("Completed");
  await expect(page.locator("#console")).toContainText("001 | The climate archive");

  await page.getByRole("tab", { name: "Records" }).click();
  await page.locator("#records-example").selectOption({ label: "Logical deletion" });
  await page.locator("#run-button").click();
  await expect(page.locator("#output-status")).toHaveText("Completed");
  await expect(page.locator("#console")).toContainText('"status": "deleted"');

  await page.getByRole("tab", { name: "FDT", exact: true }).click();
  await page.locator("#fdt-example").selectOption({ label: "Strict byte limits" });
  await page.locator("#run-button").click();
  await expect(page.locator("#output-status")).toHaveText("Failed");
  await expect(page.locator("#console")).toContainText('"code": "field-too-long"');

  await page.getByRole("tab", { name: "MX", exact: true }).click();
  await page.locator("#mx-example").selectOption({ label: "Sequence input" });
  await page.locator("#run-button").click();
  await expect(page.locator("#output-status")).toHaveText("Completed");
  await expect(page.locator("#console")).toContainText("001|First sequence record");
});

test("executes every bundled example", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Full preset sweep runs once in Chromium");
  await page.goto("/build/pages/index.html");
  await page.waitForFunction(() => window.__cisisPlaygroundReady);

  const runExamples = async (tab, select, expectedStates) => {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    for (const [label, expected] of expectedStates) {
      await page.locator(select).selectOption({ label });
      await page.locator("#run-button").click();
      await expect(page.locator("#output-status")).toHaveText(expected);
      await expect(page.locator("#run-button")).toBeEnabled();
    }
  };

  await runExamples("PFT", "#pft-example", [
    ["Catalog overview", "Completed"],
    ["Repeated authors", "Completed"],
    ["Imprint subfields", "Completed"],
    ["Conditional fields", "Completed"],
  ]);
  await runExamples("FST + Search", "#search-example", [
    ["Title words", "Completed"],
    ["Author words", "Completed"],
    ["Subject words", "Completed"],
    ["Compound AND", "Completed"],
  ]);
  await runExamples("WXIS", "#wxis-example", [
    ["CGI parameter + loop", "Completed"],
    ["Database range", "Completed"],
    ["Dynamic PFT check", "Completed"],
  ]);
  await runExamples("Records", "#records-example", [
    ["Active catalog", "Completed"],
    ["Logical deletion", "Completed"],
    ["Repeated + subfields", "Completed"],
  ]);
  await page.locator("#reset-button").click();
  await runExamples("FDT", "#fdt-example", [
    ["Demo catalog schema", "Completed"],
    ["Strict byte limits", "Failed"],
    ["Minimal title schema", "Failed"],
  ]);
  await runExamples("MX", "#mx-example", [
    ["List records", "Completed"],
    ["Select one MFN", "Completed"],
    ["Sequence input", "Completed"],
  ]);
});
