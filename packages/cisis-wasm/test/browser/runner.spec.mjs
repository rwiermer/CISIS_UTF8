import { expect, test } from "@playwright/test";

test("runs MX/PFT and WXIS in the packaged browser worker", async ({ page }) => {
  await page.goto("/tests/browser/runner.html");
  await page.waitForFunction(() => window.__cisisTestResult || window.__cisisTestError);

  const error = await page.evaluate(() => window.__cisisTestError);
  expect(error).toBeUndefined();
  const result = await page.evaluate(() => window.__cisisTestResult);
  expect(result.mx).toEqual({
    exitCode: 0,
    stdout: "This is a test in UTF8",
    stderr: "",
  });
  expect(result.wxis.exitCode).toBe(0);
  expect(result.wxis.stderr).toBe("");
  expect(result.wxis.stdout).toContain("Content-type: text/html");
  expect(result.wxis.stdout).toContain("Hello world!");
  expect(result.recordFormatted).toEqual({
    exitCode: 0,
    stdout: "日本語 title|Ada;Grace|Paris|Press",
    stderr: "",
  });
  expect(result.formatted.exitCode).toBe(0);
  expect(result.formatted.stderr).toBe("");
  expect(result.formatted.stdout).toContain("0001|Techniques for the measurement");
  expect(result.projectFiles).toEqual(["cds.iso", "cds.mst", "cds.xrf"]);
  expect(result.persistedProjects).toContain("cds");
  expect(result.persistedFileCount).toBe(3);
  expect(result.archiveBytes).toBeGreaterThan(70_000);
  expect(result.persistenceMigration).toEqual({
    fileBytes: [1, 2, 3],
    updatedAtIndex: true,
    corruptionCode: "corrupt",
  });
  expect(result.deleted).toEqual({ exitCode: 0, fileState: false, retained: false });
});
