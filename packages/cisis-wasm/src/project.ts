import { normalizeVirtualPath } from "./path.js";
import { decodeProjectArchive, encodeProjectArchive } from "./archive.js";
import type { CisisRunner } from "./index.js";
import type {
  CisisInputFile,
  CisisReadRecordsResult,
  CisisRunRequest,
  CisisRunResult,
  FormatRequest,
  IndexRequest,
  IsisScriptRequest,
  SearchRequest,
  ReadRecordsRequest,
  WriteRecordsRequest,
} from "./types.js";

export interface CisisProjectSnapshot {
  schemaVersion: 1;
  files: Record<string, Uint8Array>;
}

export type ProjectFormatRequest = Omit<FormatRequest, "files">;
export type ProjectIndexRequest = Omit<IndexRequest, "files">;
export type ProjectSearchRequest = Omit<SearchRequest, "files">;
export type ProjectIsisScriptRequest = Omit<IsisScriptRequest, "files">;
export type ProjectWriteRecordsRequest = Omit<WriteRecordsRequest, "files"> & {
  expectedRevision?: number;
};
export type ProjectReadRecordsRequest = Omit<ReadRecordsRequest, "files">;

function bytes(data: CisisInputFile): Uint8Array {
  const value = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return value.slice();
}

function equalBytes(left: Uint8Array | undefined, right: Uint8Array): boolean {
  return left?.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index]);
}

export class CisisProjectConflictError extends Error {
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(expectedRevision: number, actualRevision: number) {
    super(`CISIS project revision conflict: expected ${expectedRevision}, actual ${actualRevision}`);
    this.name = "CisisProjectConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class CisisProject {
  readonly runner: CisisRunner;
  #files = new Map<string, Uint8Array>();
  #mutationTail: Promise<void> = Promise.resolve();
  #revision = 0;

  constructor(runner: CisisRunner, files: Record<string, CisisInputFile> = {}) {
    this.runner = runner;
    for (const [path, data] of Object.entries(files)) {
      this.#files.set(normalizeVirtualPath(path), bytes(data));
    }
  }

  static fromArchive(runner: CisisRunner, archive: ArrayBuffer | Uint8Array): CisisProject {
    return new CisisProject(runner, decodeProjectArchive(archive).files);
  }

  listFiles(): string[] {
    return [...this.#files.keys()].sort();
  }

  get revision(): number {
    return this.#revision;
  }

  hasFile(path: string): boolean {
    return this.#files.has(normalizeVirtualPath(path));
  }

  readFile(path: string): Uint8Array | undefined {
    return this.#files.get(normalizeVirtualPath(path))?.slice();
  }

  writeFile(path: string, data: CisisInputFile): void {
    const normalized = normalizeVirtualPath(path);
    const value = bytes(data);
    if (equalBytes(this.#files.get(normalized), value)) return;
    this.#files.set(normalized, value);
    this.#revision += 1;
  }

  deleteFile(path: string): boolean {
    const deleted = this.#files.delete(normalizeVirtualPath(path));
    if (deleted) this.#revision += 1;
    return deleted;
  }

  snapshot(): CisisProjectSnapshot {
    return { schemaVersion: 1, files: this.#fileRecord() };
  }

  exportArchive(): Uint8Array {
    return encodeProjectArchive(this.snapshot());
  }

  async run(request: CisisRunRequest): Promise<CisisRunResult> {
    return this.#enqueueMutation((files) => this.runner.run({
      ...request,
      files: { ...files, ...request.files },
    }));
  }

  async format(request: ProjectFormatRequest): Promise<CisisRunResult> {
    return this.runner.format({ ...request, files: await this.#stableFiles() });
  }

  async index(request: ProjectIndexRequest): Promise<CisisRunResult> {
    return this.#enqueueMutation((files) => this.runner.index({ ...request, files }));
  }

  async writeRecords(request: ProjectWriteRecordsRequest): Promise<CisisRunResult> {
    const { expectedRevision, ...writeRequest } = request;
    return this.#enqueueMutation(
      (files) => this.runner.writeRecords({ ...writeRequest, files }),
      expectedRevision,
    );
  }

  async readRecords(request: ProjectReadRecordsRequest): Promise<CisisReadRecordsResult> {
    return this.runner.readRecords({ ...request, files: await this.#stableFiles() });
  }

  async search(request: ProjectSearchRequest): Promise<CisisRunResult> {
    return this.runner.search({ ...request, files: await this.#stableFiles() });
  }

  async runIsisScript(request: ProjectIsisScriptRequest): Promise<CisisRunResult> {
    return this.#enqueueMutation((files) => this.runner.runIsisScript({
      ...request,
      files,
    }));
  }

  #absorb(result: CisisRunResult): void {
    let changed = false;
    for (const [path, exists] of Object.entries(result.fileStates)) {
      if (!exists && this.#files.delete(normalizeVirtualPath(path))) changed = true;
    }
    for (const [path, data] of Object.entries(result.files)) {
      const normalized = normalizeVirtualPath(path);
      if (equalBytes(this.#files.get(normalized), data)) continue;
      this.#files.set(normalized, data.slice());
      changed = true;
    }
    if (changed) this.#revision += 1;
  }

  #enqueueMutation(
    execute: (files: Record<string, Uint8Array>) => Promise<CisisRunResult>,
    expectedRevision?: number,
  ): Promise<CisisRunResult> {
    if (
      expectedRevision !== undefined &&
      (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    ) {
      return Promise.reject(new Error("CISIS expectedRevision must be a non-negative integer"));
    }
    const operation = this.#mutationTail.then(async () => {
      if (expectedRevision !== undefined && expectedRevision !== this.#revision) {
        throw new CisisProjectConflictError(expectedRevision, this.#revision);
      }
      const startingRevision = this.#revision;
      const result = await execute(this.#fileRecord());
      if (this.#revision !== startingRevision) {
        throw new CisisProjectConflictError(startingRevision, this.#revision);
      }
      this.#absorb(result);
      return result;
    });
    this.#mutationTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async #stableFiles(): Promise<Record<string, Uint8Array>> {
    await this.#mutationTail;
    return this.#fileRecord();
  }

  #fileRecord(): Record<string, Uint8Array> {
    return Object.fromEntries([...this.#files].map(([path, data]) => [path, data.slice()]));
  }
}
