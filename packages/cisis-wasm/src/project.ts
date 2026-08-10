import { normalizeVirtualPath } from "./path.js";
import { decodeProjectArchive, encodeProjectArchive } from "./archive.js";
import type { CisisRunner } from "./index.js";
import type {
  CisisInputFile,
  CisisRunRequest,
  CisisRunResult,
  FormatRequest,
  IndexRequest,
  IsisScriptRequest,
  SearchRequest,
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
export type ProjectWriteRecordsRequest = Omit<WriteRecordsRequest, "files">;

function bytes(data: CisisInputFile): Uint8Array {
  const value = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return value.slice();
}

export class CisisProject {
  readonly runner: CisisRunner;
  #files = new Map<string, Uint8Array>();

  constructor(runner: CisisRunner, files: Record<string, CisisInputFile> = {}) {
    this.runner = runner;
    for (const [path, data] of Object.entries(files)) this.writeFile(path, data);
  }

  static fromArchive(runner: CisisRunner, archive: ArrayBuffer | Uint8Array): CisisProject {
    return new CisisProject(runner, decodeProjectArchive(archive).files);
  }

  listFiles(): string[] {
    return [...this.#files.keys()].sort();
  }

  hasFile(path: string): boolean {
    return this.#files.has(normalizeVirtualPath(path));
  }

  readFile(path: string): Uint8Array | undefined {
    return this.#files.get(normalizeVirtualPath(path))?.slice();
  }

  writeFile(path: string, data: CisisInputFile): void {
    this.#files.set(normalizeVirtualPath(path), bytes(data));
  }

  deleteFile(path: string): boolean {
    return this.#files.delete(normalizeVirtualPath(path));
  }

  snapshot(): CisisProjectSnapshot {
    return { schemaVersion: 1, files: this.#fileRecord() };
  }

  exportArchive(): Uint8Array {
    return encodeProjectArchive(this.snapshot());
  }

  async run(request: CisisRunRequest): Promise<CisisRunResult> {
    const result = await this.runner.run({
      ...request,
      files: { ...this.#fileRecord(), ...request.files },
    });
    this.#absorb(result);
    return result;
  }

  async format(request: ProjectFormatRequest): Promise<CisisRunResult> {
    return this.runner.format({ ...request, files: this.#fileRecord() });
  }

  async index(request: ProjectIndexRequest): Promise<CisisRunResult> {
    const result = await this.runner.index({ ...request, files: this.#fileRecord() });
    this.#absorb(result);
    return result;
  }

  async writeRecords(request: ProjectWriteRecordsRequest): Promise<CisisRunResult> {
    const result = await this.runner.writeRecords({ ...request, files: this.#fileRecord() });
    this.#absorb(result);
    return result;
  }

  search(request: ProjectSearchRequest): Promise<CisisRunResult> {
    return this.runner.search({ ...request, files: this.#fileRecord() });
  }

  async runIsisScript(request: ProjectIsisScriptRequest): Promise<CisisRunResult> {
    const result = await this.runner.runIsisScript({
      ...request,
      files: this.#fileRecord(),
    });
    this.#absorb(result);
    return result;
  }

  #absorb(result: CisisRunResult): void {
    for (const [path, exists] of Object.entries(result.fileStates)) {
      if (!exists) this.deleteFile(path);
    }
    for (const [path, data] of Object.entries(result.files)) this.writeFile(path, data);
  }

  #fileRecord(): Record<string, Uint8Array> {
    return Object.fromEntries([...this.#files].map(([path, data]) => [path, data.slice()]));
  }
}
