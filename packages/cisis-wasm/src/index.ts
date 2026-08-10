import { normalizeVirtualPath } from "./path.js";
import { CisisProject } from "./project.js";
import type { WorkerRunRequest, WorkerRunResponse } from "./protocol.js";
import type {
  CisisInputFile,
  CisisModuleUrls,
  CisisRunRequest,
  CisisRunResult,
  CisisRunnerOptions,
  FormatRequest,
  IndexRequest,
  IsisScriptRequest,
  SearchRequest,
} from "./types.js";

export type {
  CisisDiagnostic,
  CisisDiagnosticCategory,
  CisisInputFile,
  CisisModuleUrls,
  CisisProgram,
  CisisRunRequest,
  CisisRunResult,
  CisisRunnerOptions,
  FormatRequest,
  IndexRequest,
  IsisScriptRequest,
  SearchRequest,
} from "./types.js";
export {
  CisisProject,
  type CisisProjectSnapshot,
  type ProjectFormatRequest,
  type ProjectIndexRequest,
  type ProjectIsisScriptRequest,
  type ProjectSearchRequest,
} from "./project.js";
export { CisisProjectStore } from "./persistence.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_INPUT_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_RETURNED_FILE_BYTES = 64 * 1024 * 1024;
const DEFAULT_ENVIRONMENT_ALLOWLIST = [
  "CIPAR",
  "LANG",
  "LC_ALL",
  "QUERY_STRING",
  "REQUEST_METHOD",
] as const;

interface QueuedRun {
  request: CisisRunRequest;
  resolve: (result: CisisRunResult) => void;
  reject: (error: Error) => void;
}

interface ActiveRun extends QueuedRun {
  id: number;
  timer: ReturnType<typeof setTimeout>;
}

function databaseName(value: string): string {
  if (value.includes("=") || value.startsWith("-")) {
    throw new Error(`Invalid CISIS database name: ${value}`);
  }
  return normalizeVirtualPath(value);
}

function positiveInteger(name: string, value: number | undefined): number | undefined {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new Error(`CISIS ${name} must be a positive integer`);
  }
  return value;
}

function optionalTimeout(timeoutMs: number | undefined): { timeoutMs?: number } {
  return timeoutMs === undefined ? {} : { timeoutMs };
}

function validateRequest(
  request: CisisRunRequest,
  environmentAllowlist: Set<string>,
  maxInputBytes: number,
): void {
  if (request.program !== "mx" && request.program !== "wxis") {
    throw new Error(`Unsupported CISIS program: ${String(request.program)}`);
  }
  if (!Array.isArray(request.args) || request.args.some((arg) => typeof arg !== "string")) {
    throw new Error("CISIS arguments must be strings");
  }
  for (const path of Object.keys(request.files ?? {})) normalizeVirtualPath(path);
  const encoder = new TextEncoder();
  let inputBytes = 0;
  for (const data of Object.values(request.files ?? {})) {
    inputBytes += typeof data === "string" ? encoder.encode(data).byteLength : data.byteLength;
    if (inputBytes > maxInputBytes) {
      throw new Error(`CISIS input files exceed ${maxInputBytes} bytes`);
    }
  }
  for (const path of request.returnFiles ?? []) normalizeVirtualPath(path);
  for (const path of request.inspectFiles ?? []) normalizeVirtualPath(path);
  for (const key of Object.keys(request.env ?? {})) {
    if (!environmentAllowlist.has(key)) {
      throw new Error(`CISIS environment variable is not allowlisted: ${key}`);
    }
  }
  if (request.timeoutMs !== undefined && (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0)) {
    throw new Error("CISIS timeoutMs must be a positive finite number");
  }
  for (const [name, value] of [
    ["maxOutputBytes", request.maxOutputBytes],
    ["maxReturnedFileBytes", request.maxReturnedFileBytes],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      throw new Error(`CISIS ${name} must be a positive finite number`);
    }
  }
}

export class CisisRunner {
  readonly moduleUrls: CisisModuleUrls;
  readonly workerUrl: URL;
  readonly defaultTimeoutMs: number;
  readonly maxInputBytes: number;
  readonly defaultMaxOutputBytes: number;
  readonly defaultMaxReturnedFileBytes: number;

  #active: ActiveRun | undefined;
  #disposed = false;
  #environmentAllowlist: Set<string>;
  #nextId = 1;
  #queue: QueuedRun[] = [];
  #worker: Worker | undefined;
  #workerFactory: (url: URL) => Worker;

  constructor(options: CisisRunnerOptions = {}) {
    this.moduleUrls = {
      mx: options.moduleUrls?.mx ?? new URL("./cisis-mx.mjs", import.meta.url),
      wxis: options.moduleUrls?.wxis ?? new URL("./cisis-wxis.mjs", import.meta.url),
    };
    this.workerUrl = new URL(options.workerUrl ?? "./worker.js", import.meta.url);
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
    this.defaultMaxOutputBytes = options.defaultMaxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.defaultMaxReturnedFileBytes =
      options.defaultMaxReturnedFileBytes ?? DEFAULT_MAX_RETURNED_FILE_BYTES;
    for (const [name, value] of [
      ["defaultTimeoutMs", this.defaultTimeoutMs],
      ["maxInputBytes", this.maxInputBytes],
      ["defaultMaxOutputBytes", this.defaultMaxOutputBytes],
      ["defaultMaxReturnedFileBytes", this.defaultMaxReturnedFileBytes],
    ] as const) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`CISIS ${name} must be a positive finite number`);
      }
    }
    this.#environmentAllowlist = new Set(
      options.environmentAllowlist ?? DEFAULT_ENVIRONMENT_ALLOWLIST,
    );
    this.#workerFactory = options.workerFactory ?? ((url) => new Worker(url, { type: "module" }));
  }

  run(request: CisisRunRequest): Promise<CisisRunResult> {
    if (this.#disposed) return Promise.reject(new Error("CISIS runner is disposed"));
    try {
      validateRequest(request, this.#environmentAllowlist, this.maxInputBytes);
    } catch (error) {
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      this.#queue.push({
        request: {
          ...request,
          maxOutputBytes: request.maxOutputBytes ?? this.defaultMaxOutputBytes,
          maxReturnedFileBytes:
            request.maxReturnedFileBytes ?? this.defaultMaxReturnedFileBytes,
        },
        resolve,
        reject,
      });
      this.#pump();
    });
  }

  createProject(files: Record<string, CisisInputFile> = {}): CisisProject {
    return new CisisProject(this, files);
  }

  runIsisScript(request: IsisScriptRequest): Promise<CisisRunResult> {
    const scriptPath = "program.xis";
    const args = [`IsisScript=${scriptPath}`];
    for (const [key, value] of Object.entries(request.params ?? {})) {
      if (!/^[A-Za-z0-9_.-]+$/.test(key)) throw new Error(`Invalid IsisScript parameter: ${key}`);
      if (typeof value === "boolean") {
        if (value) args.push(key);
      } else {
        args.push(`${key}=${value}`);
      }
    }
    return this.run({
      program: "wxis",
      args,
      files: { ...request.files, [scriptPath]: request.source },
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
      ...(request.returnFiles === undefined ? {} : { returnFiles: request.returnFiles }),
    });
  }

  format(request: FormatRequest): Promise<CisisRunResult> {
    const database = databaseName(request.database);
    const from = positiveInteger("format from", request.from);
    const count = positiveInteger("format count", request.count);
    return this.run({
      program: "mx",
      args: [
        database,
        `pft=${request.pft}`,
        ...(from === undefined ? [] : [`from=${from}`]),
        ...(count === undefined ? [] : [`count=${count}`]),
        "lw=0",
        "now",
      ],
      ...(request.files === undefined ? {} : { files: request.files }),
      ...optionalTimeout(request.timeoutMs),
    });
  }

  index(request: IndexRequest): Promise<CisisRunResult> {
    const database = databaseName(request.database);
    const index = databaseName(request.index ?? request.database);
    const fstPath = "__cisis/index.fst";
    const returnFiles = ["cnt", "ifp", "l01", "l02", "n01", "n02"].map(
      (extension) => `${index}.${extension}`,
    );
    return this.run({
      program: "mx",
      args: [database, `fst=@${fstPath}`, `fullinv=${index}`, "now"],
      files: { ...request.files, [fstPath]: request.fst },
      returnFiles,
      ...optionalTimeout(request.timeoutMs),
    });
  }

  search(request: SearchRequest): Promise<CisisRunResult> {
    const database = databaseName(request.database);
    const from = positiveInteger("search from", request.from);
    const count = positiveInteger("search count", request.count);
    return this.run({
      program: "mx",
      args: [
        database,
        `bool=${request.expression}`,
        `pft=${request.pft ?? "mfn/"}`,
        ...(from === undefined ? [] : [`from=${from}`]),
        ...(count === undefined ? [] : [`count=${count}`]),
        "lw=0",
        "now",
      ],
      ...(request.files === undefined ? {} : { files: request.files }),
      ...optionalTimeout(request.timeoutMs),
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#resetWorker(new Error("CISIS runner was disposed"));
    for (const queued of this.#queue.splice(0)) queued.reject(new Error("CISIS runner was disposed"));
  }

  #ensureWorker(): Worker {
    if (this.#worker) return this.#worker;
    const worker = this.#workerFactory(this.workerUrl);
    worker.onmessage = (event: MessageEvent<WorkerRunResponse>) => this.#onMessage(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      this.#resetWorker(new Error(event.message || "CISIS worker failed"));
      this.#pump();
    };
    this.#worker = worker;
    return worker;
  }

  #pump(): void {
    if (this.#disposed || this.#active || this.#queue.length === 0) return;
    const queued = this.#queue.shift();
    if (!queued) return;
    const id = this.#nextId++;
    const timeoutMs = queued.request.timeoutMs ?? this.defaultTimeoutMs;
    const timer = setTimeout(() => {
      this.#resetWorker(new Error(`CISIS execution timed out after ${timeoutMs}ms`));
      this.#pump();
    }, timeoutMs);
    this.#active = { ...queued, id, timer };

    const message: WorkerRunRequest = {
      type: "run",
      id,
      moduleUrl: String(this.moduleUrls[queued.request.program]),
      request: queued.request,
    };
    try {
      this.#ensureWorker().postMessage(message);
    } catch (error) {
      this.#resetWorker(error instanceof Error ? error : new Error(String(error)));
      this.#pump();
    }
  }

  #onMessage(message: WorkerRunResponse): void {
    const active = this.#active;
    if (!active || message.id !== active.id) return;
    clearTimeout(active.timer);
    this.#active = undefined;
    if (message.type === "result") active.resolve(message.result);
    else active.reject(new Error(message.error));
    this.#pump();
  }

  #resetWorker(error: Error): void {
    this.#worker?.terminate();
    this.#worker = undefined;
    if (this.#active) {
      clearTimeout(this.#active.timer);
      this.#active.reject(error);
      this.#active = undefined;
    }
  }
}
