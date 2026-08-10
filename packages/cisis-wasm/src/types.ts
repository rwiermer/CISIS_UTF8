export type CisisProgram = "mx" | "wxis";

export type CisisInputFile = string | Uint8Array;

export interface CisisRecordField {
  tag: number;
  value: CisisInputFile;
}

export interface CisisRecordData {
  fields: readonly CisisRecordField[];
}

export interface CisisRecord extends CisisRecordData {
  mfn: number;
  status: "active" | "deleted";
}

export type CisisDiagnosticCategory =
  | "argument"
  | "format"
  | "filesystem"
  | "runtime"
  | "unsupported";

export interface CisisDiagnostic {
  category: CisisDiagnosticCategory;
  message: string;
  raw: string;
  severity: "error" | "warning";
}

export interface CisisRunRequest {
  program: CisisProgram;
  args: string[];
  files?: Record<string, CisisInputFile>;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxReturnedFileBytes?: number;
  returnFiles?: string[];
  inspectFiles?: string[];
}

export interface CisisRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  files: Record<string, Uint8Array>;
  fileStates: Record<string, boolean>;
  diagnostics: CisisDiagnostic[];
  durationMs: number;
}

export interface CisisModuleUrls {
  mx: string | URL;
  wxis: string | URL;
}

export interface CisisRunnerOptions {
  moduleUrls?: Partial<CisisModuleUrls>;
  workerUrl?: string | URL;
  defaultTimeoutMs?: number;
  maxInputBytes?: number;
  defaultMaxOutputBytes?: number;
  defaultMaxReturnedFileBytes?: number;
  environmentAllowlist?: readonly string[];
  workerFactory?: (url: URL) => Worker;
}

export interface IsisScriptRequest {
  source: string;
  params?: Record<string, string | number | boolean>;
  files?: Record<string, CisisInputFile>;
  timeoutMs?: number;
  returnFiles?: string[];
}

export interface FormatRequest {
  database: string;
  pft: string;
  files?: Record<string, CisisInputFile>;
  from?: number;
  count?: number;
  timeoutMs?: number;
}

export interface FormatRecordRequest {
  record: CisisRecordData;
  pft: string;
  timeoutMs?: number;
}

export interface WriteRecordsRequest {
  database: string;
  records: readonly CisisRecord[];
  files?: Record<string, CisisInputFile>;
  replace?: boolean;
  timeoutMs?: number;
}

export interface ReadRecordsRequest {
  database: string;
  files?: Record<string, CisisInputFile>;
  from?: number;
  count?: number;
  timeoutMs?: number;
}

export type CisisReadRecordsResult = Omit<CisisRunResult, "files" | "fileStates"> & {
  records: CisisRecord[];
};

export interface IndexRequest {
  database: string;
  fst: string;
  files?: Record<string, CisisInputFile>;
  index?: string;
  timeoutMs?: number;
}

export interface SearchRequest {
  database: string;
  expression: string;
  files?: Record<string, CisisInputFile>;
  pft?: string;
  from?: number;
  count?: number;
  timeoutMs?: number;
}
