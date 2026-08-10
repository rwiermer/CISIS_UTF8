import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { executeRequest } from "../../packages/cisis-wasm/dist/worker-runtime.js";
import { scenarios } from "./scenarios.mjs";

function parseArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!option?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument near ${option ?? "<end>"}`);
    }
    values[option.slice(2)] = value;
  }
  for (const required of ["native-mx", "native-wxis", "wasm-mx", "wasm-wxis", "root"]) {
    if (!values[required]) throw new Error(`Missing --${required}`);
  }
  return values;
}

function checksum(data) {
  return createHash("sha256").update(data).digest("hex");
}

function normalizeOutput(value) {
  return value.replaceAll("\r\n", "\n").replace(/\n$/, "");
}

async function loadInputs(root, definitions) {
  const files = new Map();
  for (const [name, definition] of Object.entries(definitions)) {
    const data = definition.source
      ? await readFile(resolve(root, definition.source))
      : Buffer.from(definition.text, "utf8");
    files.set(name, data);
  }
  return files;
}

async function materializeFiles(directory, files) {
  for (const [name, data] of files) {
    const destination = join(directory, name);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, data);
  }
}

function nativeStep(executables, directory, step) {
  const result = spawnSync(executables[step.program], step.args, {
    cwd: directory,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return {
    exitCode: result.status ?? 128,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function collectNativeOutputs(directory, names) {
  const files = {};
  for (const name of names ?? []) files[name] = await readFile(join(directory, name));
  return files;
}

function comparableResult(result, outputNames) {
  const outputChecksums = {};
  for (const name of outputNames ?? []) outputChecksums[name] = checksum(result.files[name]);
  return {
    exitCode: result.exitCode,
    stdout: normalizeOutput(result.stdout),
    stderr: normalizeOutput(result.stderr),
    outputChecksums,
  };
}

function assertEquivalent(scenario, stepIndex, native, wasm) {
  const nativeJson = JSON.stringify(native, null, 2);
  const wasmJson = JSON.stringify(wasm, null, 2);
  if (nativeJson !== wasmJson) {
    throw new Error(
      `${scenario} step ${stepIndex + 1} differs\n--- native\n${nativeJson}\n--- wasm\n${wasmJson}`,
    );
  }
}

const options = parseArguments(process.argv.slice(2));
const root = resolve(options.root);
const nativeExecutables = {
  mx: resolve(options["native-mx"]),
  wxis: resolve(options["native-wxis"]),
};
const wasmModules = {
  mx: pathToFileURL(resolve(options["wasm-mx"])).href,
  wxis: pathToFileURL(resolve(options["wasm-wxis"])).href,
};
const report = {
  schemaVersion: 1,
  normalization: ["CRLF to LF", "remove one terminal LF"],
  scenarios: [],
};
let requestId = 1;

for (const scenario of scenarios) {
  const directory = await mkdtemp(join(tmpdir(), `cisis-${scenario.name}-`));
  const wasmFiles = await loadInputs(root, scenario.files);
  await materializeFiles(directory, wasmFiles);
  const scenarioReport = {
    name: scenario.name,
    group: scenario.group,
    inputChecksums: Object.fromEntries(
      [...wasmFiles].map(([name, data]) => [name, checksum(data)]),
    ),
    steps: [],
  };

  try {
    for (const [stepIndex, step] of scenario.steps.entries()) {
      const nativeRaw = nativeStep(nativeExecutables, directory, step);
      nativeRaw.files = await collectNativeOutputs(directory, step.outputs);

      const wasmRaw = await executeRequest(requestId, wasmModules[step.program], {
        program: step.program,
        args: step.args,
        files: Object.fromEntries(wasmFiles),
        returnFiles: step.outputs,
      });
      requestId += 1;

      for (const [name, data] of Object.entries(wasmRaw.files)) wasmFiles.set(name, data);
      const native = comparableResult(nativeRaw, step.outputs);
      const wasm = comparableResult(wasmRaw, step.outputs);
      assertEquivalent(scenario.name, stepIndex, native, wasm);
      scenarioReport.steps.push({
        program: step.program,
        args: step.args,
        native,
        wasm,
      });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  report.scenarios.push(scenarioReport);
  console.log(`PASS ${scenario.group}/${scenario.name}`);
}

if (options.report) {
  const reportPath = isAbsolute(options.report) ? options.report : resolve(options.report);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(`${scenarios.length} native/Wasm differential scenarios passed.`);
