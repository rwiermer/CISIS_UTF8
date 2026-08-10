import { normalizeVirtualPath } from "./path.js";
import { CisisProject } from "./project.js";
import { decodeIso2709Records, encodeIso2709Record } from "./record.js";
import type { WorkerRunRequest, WorkerRunResponse } from "./protocol.js";
import type {
  CisisInputFile,
  CisisRecord,
  CisisRecordData,
  CisisRecordField,
  CisisModuleUrls,
  CisisRunRequest,
  CisisRunResult,
  CisisReadRecordsResult,
  CisisRunnerOptions,
  FormatRequest,
  FormatRecordRequest,
  IndexRequest,
  IsisScriptRequest,
  SearchRequest,
  ReadRecordsRequest,
  WriteRecordsRequest,
} from "./types.js";

export type {
  CisisDiagnostic,
  CisisDiagnosticCategory,
  CisisInputFile,
  CisisRecord,
  CisisRecordData,
  CisisRecordField,
  CisisModuleUrls,
  CisisProgram,
  CisisRunRequest,
  CisisRunResult,
  CisisReadRecordsResult,
  CisisRunnerOptions,
  FormatRequest,
  FormatRecordRequest,
  IndexRequest,
  IsisScriptRequest,
  SearchRequest,
  ReadRecordsRequest,
  WriteRecordsRequest,
} from "./types.js";
export {
  CisisProject,
  CisisProjectConflictError,
  type CisisProjectSnapshot,
  type ProjectFormatRequest,
  type ProjectIndexRequest,
  type ProjectIsisScriptRequest,
  type ProjectSearchRequest,
  type ProjectReadRecordsRequest,
  type ProjectWriteRecordsRequest,
} from "./project.js";
export {
  CisisProjectStore,
  CisisProjectStoreError,
  type CisisProjectStoreErrorCode,
} from "./persistence.js";
export { decodeProjectArchive, encodeProjectArchive } from "./archive.js";
export { decodeIso2709Records, encodeIso2709Record } from "./record.js";

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
const MAX_RECORD_MFN = 1_000_000;
const MAX_RECORDS_PER_WRITE = 1_000;
const INDEX_EXTENSIONS = ["cnt", "ifp", "l01", "l02", "n01", "n02"] as const;
const SILENT_PFT = "pft=if 1=0 then mfn fi";
const READ_METADATA_TAG = 999;
const READ_METADATA_MARKER = "CISISWASMREAD";

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

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
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

  async formatRecord(request: FormatRecordRequest): Promise<CisisRunResult> {
    const isoPath = "__cisis/record.iso";
    const database = "__cisis/record";
    const imported = await this.run({
      program: "mx",
      args: [`iso=marc=${isoPath}`, `create=${database}`, "now"],
      files: { [isoPath]: encodeIso2709Record(request.record) },
      returnFiles: [`${database}.mst`, `${database}.xrf`],
      ...optionalTimeout(request.timeoutMs),
    });
    if (imported.exitCode !== 0) return imported;

    const formatted = await this.format({
      database,
      pft: request.pft,
      files: imported.files,
      ...optionalTimeout(request.timeoutMs),
    });
    return { ...formatted, durationMs: imported.durationMs + formatted.durationMs };
  }

  async writeRecords(request: WriteRecordsRequest): Promise<CisisRunResult> {
    const database = databaseName(request.database);
    if (request.records.length > MAX_RECORDS_PER_WRITE) {
      throw new Error(`A record write is limited to ${MAX_RECORDS_PER_WRITE} records`);
    }

    const mfns = new Set<number>();
    const usedTags = new Set<number>();
    for (const record of request.records) {
      if (!Number.isSafeInteger(record.mfn) || record.mfn < 1 || record.mfn > MAX_RECORD_MFN) {
        throw new Error(`CISIS record MFN must be between 1 and ${MAX_RECORD_MFN}: ${record.mfn}`);
      }
      if (mfns.has(record.mfn)) throw new Error(`Duplicate CISIS record MFN: ${record.mfn}`);
      if (record.status !== "active" && record.status !== "deleted") {
        throw new Error(`Invalid CISIS record status at MFN ${record.mfn}: ${String(record.status)}`);
      }
      mfns.add(record.mfn);
      for (const field of record.fields) usedTags.add(field.tag);
    }

    const targetFiles = [`${database}.mst`, `${database}.xrf`];
    const indexFiles = INDEX_EXTENSIONS.map((extension) => `${database}.${extension}`);
    const files = Object.fromEntries(
      Object.entries(request.files ?? {}).filter(([path]) => !indexFiles.includes(path)),
    );
    const hasMst = Object.hasOwn(files, targetFiles[0]!);
    const hasXrf = Object.hasOwn(files, targetFiles[1]!);
    if (!request.replace && hasMst !== hasXrf) {
      throw new Error(`CISIS database requires both ${targetFiles.join(" and ")}`);
    }
    const create = request.replace === true || !hasMst;
    const invalidatedStates = Object.fromEntries(indexFiles.map((path) => [path, false]));

    if (request.records.length === 0) {
      if (!create) {
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          files: {},
          fileStates: {},
          diagnostics: [],
          durationMs: 0,
        };
      }
      const empty = await this.run({
        program: "mx",
        args: ["null", "count=0", `create=${database}`, "now"],
        files,
        returnFiles: targetFiles,
        ...optionalTimeout(request.timeoutMs),
      });
      return empty.exitCode === 0
        ? { ...empty, fileStates: { ...empty.fileStates, ...invalidatedStates } }
        : { ...empty, files: {}, fileStates: {} };
    }

    let metadataTag = 999;
    while (metadataTag > 0 && usedTags.has(metadataTag)) metadataTag -= 1;
    if (metadataTag === 0) {
      throw new Error("Structured record writes require one unused CISIS field tag");
    }

    const iso = concatenate(request.records.map((record) => encodeIso2709Record({
      fields: [
        { tag: metadataTag, value: `^m${record.mfn}^s${record.status === "deleted" ? "D" : "A"}` },
        ...record.fields,
      ],
    })));
    const imported = await this.run({
      program: "mx",
      args: [
        "iso=marc=__cisis/records.iso",
        `proc='='v${metadataTag}^m`,
        `${create ? "create" : "copy"}=${database}`,
        SILENT_PFT,
        "now",
      ],
      files: { ...files, "__cisis/records.iso": iso },
      returnFiles: targetFiles,
      ...optionalTimeout(request.timeoutMs),
    });
    if (imported.exitCode !== 0) return { ...imported, files: {}, fileStates: {} };

    const source = "__cisis/write-source";
    const selected = request.records.map((record) => `mfn=${record.mfn}`).join(" or ");
    const finalized = await this.run({
      program: "mx",
      args: [
        source,
        `proc=if ${selected} then if v${metadataTag}^s='D' then 'D.' fi,'d${metadataTag}' fi`,
        `copy=${database}`,
        SILENT_PFT,
        "now",
      ],
      files: {
        ...files,
        ...imported.files,
        [`${source}.mst`]: imported.files[targetFiles[0]!]!,
        [`${source}.xrf`]: imported.files[targetFiles[1]!]!,
      },
      returnFiles: targetFiles,
      ...optionalTimeout(request.timeoutMs),
    });
    return {
      ...finalized,
      stdout: imported.stdout + finalized.stdout,
      stderr: imported.stderr + finalized.stderr,
      diagnostics: [...imported.diagnostics, ...finalized.diagnostics],
      durationMs: imported.durationMs + finalized.durationMs,
      files: finalized.exitCode === 0 ? finalized.files : {},
      fileStates: finalized.exitCode === 0
        ? { ...finalized.fileStates, ...invalidatedStates }
        : {},
    };
  }

  async readRecords(request: ReadRecordsRequest): Promise<CisisReadRecordsResult> {
    const database = databaseName(request.database);
    const from = positiveInteger("record read from", request.from);
    const count = positiveInteger("record read count", request.count);
    const isoPath = "__cisis-read-records.iso";
    const run = await this.run({
      program: "mx",
      args: [
        database,
        `proc='a${READ_METADATA_TAG}|^m'mfn'^c${READ_METADATA_MARKER}|'`,
        `outiso=marc=${isoPath}`,
        ...(from === undefined ? [] : [`from=${from}`]),
        ...(count === undefined ? [] : [`count=${count}`]),
        SILENT_PFT,
        "now",
      ],
      ...(request.files === undefined ? {} : { files: request.files }),
      returnFiles: [isoPath],
      ...optionalTimeout(request.timeoutMs),
    });

    const baseResult = {
      exitCode: run.exitCode,
      stdout: run.stdout,
      stderr: run.stderr,
      diagnostics: run.diagnostics,
      durationMs: run.durationMs,
    };
    if (run.exitCode !== 0) return { ...baseResult, records: [] };

    const decoded = decodeIso2709Records(run.files[isoPath] ?? new Uint8Array());
    const decoder = new TextDecoder();
    const records = decoded.map((record): CisisRecord => {
      let metadataIndex = -1;
      let mfn = 0;
      for (let index = record.fields.length - 1; index >= 0; index -= 1) {
        const field = record.fields[index]!;
        if (field.tag !== READ_METADATA_TAG || typeof field.value === "string") continue;
        const match = /^\^m(\d+)\^cCISISWASMREAD$/.exec(decoder.decode(field.value));
        if (!match) continue;
        metadataIndex = index;
        mfn = Number(match[1]);
        break;
      }
      if (metadataIndex < 0 || !Number.isSafeInteger(mfn) || mfn < 1) {
        throw new Error("CISIS record export is missing valid MFN metadata");
      }
      return {
        mfn,
        status: "active",
        fields: record.fields.filter((_, index) => index !== metadataIndex),
      };
    });
    return { ...baseResult, records };
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
