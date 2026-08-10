import { collectDiagnostics } from "./diagnostics.js";
import { normalizeVirtualPath, parentDirectories } from "./path.js";
import type { CisisInputFile, CisisRunRequest, CisisRunResult } from "./types.js";

interface EmscriptenFileSystem {
  analyzePath(path: string): { exists: boolean };
  chdir(path: string): void;
  mkdir(path: string): void;
  mkdirTree(path: string): void;
  readFile(path: string): Uint8Array;
  writeFile(path: string, data: string | Uint8Array): void;
}

interface EmscriptenModule {
  ENV?: Record<string, string>;
  FS: EmscriptenFileSystem;
  callMain(args: string[]): number;
}

type EmscriptenFactory = (options: {
  noInitialRun: boolean;
  print: (line: string) => void;
  printErr: (line: string) => void;
}) => Promise<EmscriptenModule>;

export type ModuleLoader = (url: string) => Promise<{ default: EmscriptenFactory }>;

const defaultModuleLoader: ModuleLoader = async (url) => import(/* @vite-ignore */ url);

function positiveLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function writeFile(
  module: EmscriptenModule,
  requestRoot: string,
  path: string,
  data: CisisInputFile,
): void {
  const normalized = normalizeVirtualPath(path);
  for (const parent of parentDirectories(normalized)) {
    try {
      module.FS.mkdir(`${requestRoot}/${parent}`);
    } catch {
      // The directory already exists within this fresh request filesystem.
    }
  }
  module.FS.writeFile(`${requestRoot}/${normalized}`, data);
}

function exitStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = Reflect.get(error, "status");
  return typeof status === "number" ? status : undefined;
}

export async function executeRequest(
  id: number,
  moduleUrl: string,
  request: CisisRunRequest,
  loadModule: ModuleLoader = defaultModuleLoader,
): Promise<CisisRunResult> {
  const started = performance.now();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const encoder = new TextEncoder();
  const maxOutputBytes = positiveLimit(request.maxOutputBytes, 4 * 1024 * 1024);
  const maxReturnedFileBytes = positiveLimit(
    request.maxReturnedFileBytes,
    64 * 1024 * 1024,
  );
  let outputBytes = 0;
  const appendOutput = (target: string[], line: string): void => {
    outputBytes += encoder.encode(line).byteLength + 1;
    if (outputBytes > maxOutputBytes) {
      throw new Error(`CISIS output exceeded ${maxOutputBytes} bytes`);
    }
    target.push(line);
  };
  const imported = await loadModule(moduleUrl);
  const module = await imported.default({
    noInitialRun: true,
    print: (line) => appendOutput(stdout, line),
    printErr: (line) => appendOutput(stderr, line),
  });
  const requestRoot = `/work/${id}`;
  module.FS.mkdirTree(requestRoot);

  for (const [path, data] of Object.entries(request.files ?? {})) {
    writeFile(module, requestRoot, path, data);
  }
  module.FS.chdir(requestRoot);
  if (module.ENV) Object.assign(module.ENV, request.env);

  let exitCode = 0;
  try {
    exitCode = module.callMain(request.args);
  } catch (error) {
    const status = exitStatus(error);
    if (status === undefined) {
      exitCode = 1;
      stderr.push(error instanceof Error ? error.message : String(error));
    } else {
      exitCode = status;
    }
  }

  const files: Record<string, Uint8Array> = {};
  let returnedFileBytes = 0;
  for (const path of request.returnFiles ?? []) {
    const normalized = normalizeVirtualPath(path);
    const data = module.FS.readFile(`${requestRoot}/${normalized}`);
    returnedFileBytes += data.byteLength;
    if (returnedFileBytes > maxReturnedFileBytes) {
      throw new Error(`CISIS returned files exceeded ${maxReturnedFileBytes} bytes`);
    }
    files[normalized] = data;
  }

  const fileStates: Record<string, boolean> = {};
  for (const path of request.inspectFiles ?? []) {
    const normalized = normalizeVirtualPath(path);
    fileStates[normalized] = module.FS.analyzePath(`${requestRoot}/${normalized}`).exists;
  }

  const stdoutText = stdout.join("\n");
  const stderrText = stderr.join("\n");
  return {
    exitCode,
    stdout: stdoutText,
    stderr: stderrText,
    files,
    fileStates,
    diagnostics: collectDiagnostics(stdoutText, stderrText),
    durationMs: performance.now() - started,
  };
}
