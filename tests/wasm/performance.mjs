import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

import { decodeCisisRecordExport } from "../../packages/cisis-wasm/dist/record.js";
import { executeRequest } from "../../packages/cisis-wasm/dist/worker-runtime.js";

const [mxPathValue, wxisPathValue, rootValue, reportValue] = process.argv.slice(2);
if (!mxPathValue || !wxisPathValue || !rootValue || !reportValue) {
  throw new Error("usage: node performance.mjs <mx.mjs> <wxis.mjs> <root> <report.json>");
}

const root = resolve(rootValue);
const mxPath = resolve(mxPathValue);
const wxisPath = resolve(wxisPathValue);
const mxWasmPath = mxPath.replace(/\.mjs$/, ".wasm");
const wxisWasmPath = wxisPath.replace(/\.mjs$/, ".wasm");
const mxUrl = pathToFileURL(mxPath).href;
const iterations = 5;
let requestId = 1;

async function size(path) {
  return (await stat(path)).size;
}

function statistics(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
    samples: values,
  };
}

const iso = await readFile(resolve(root, "wxis_src/examples/cds/cds.iso"));
const imported = await executeRequest(requestId++, mxUrl, {
  program: "mx",
  args: ["iso=cds.iso", "create=cds", "now"],
  files: { "cds.iso": iso },
  returnFiles: ["cds.mst", "cds.xrf"],
  maxOutputBytes: 8 * 1024 * 1024,
});
if (imported.exitCode !== 0) throw new Error(`Benchmark database import failed: ${imported.stderr}`);

const formatDurations = [];
const recordReadDurations = [];
let recordsRead = 0;
for (let iteration = 0; iteration < iterations; iteration += 1) {
  const formatted = await executeRequest(requestId++, mxUrl, {
    program: "mx",
    args: ["cds", "count=100", "pft=mfn/", "lw=0", "now"],
    files: imported.files,
  });
  if (formatted.exitCode !== 0) throw new Error(`Benchmark format failed: ${formatted.stderr}`);
  formatDurations.push(formatted.durationMs);

  const outputPath = "records.bin";
  const read = await executeRequest(requestId++, mxUrl, {
    program: "mx",
    args: [],
    files: imported.files,
    returnFiles: [outputPath],
    directRecordRead: { database: "cds", from: 1, count: 100, outputPath },
  });
  if (read.exitCode !== 0) throw new Error(`Benchmark record read failed: ${read.stderr}`);
  recordsRead = decodeCisisRecordExport(read.files[outputPath]).length;
  recordReadDurations.push(read.durationMs);
}

const artifacts = {
  mxJavaScriptBytes: await size(mxPath),
  mxWasmBytes: await size(mxWasmPath),
  wxisJavaScriptBytes: await size(wxisPath),
  wxisWasmBytes: await size(wxisWasmPath),
};
const artifactBudgets = {
  mxJavaScriptBytes: 128 * 1024,
  mxWasmBytes: 512 * 1024,
  wxisJavaScriptBytes: 128 * 1024,
  wxisWasmBytes: 640 * 1024,
};
for (const [name, budget] of Object.entries(artifactBudgets)) {
  if (artifacts[name] > budget) {
    throw new Error(`${name} is ${artifacts[name]} bytes and exceeds its ${budget}-byte budget`);
  }
}

const report = {
  schemaVersion: 1,
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  iterations,
  artifacts,
  artifactBudgets,
  fixture: {
    isoBytes: iso.byteLength,
    databaseBytes: imported.files["cds.mst"].byteLength + imported.files["cds.xrf"].byteLength,
    recordsRead,
  },
  timingMs: {
    databaseImport: imported.durationMs,
    format100: statistics(formatDurations),
    directRecordRead100: statistics(recordReadDurations),
  },
};

const reportPath = resolve(reportValue);
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
