import type { CisisProjectSnapshot } from "./project.js";
import { normalizeVirtualPath } from "./path.js";

interface StoredProject extends CisisProjectSnapshot {
  name: string;
  updatedAt: number;
}

export type CisisProjectStoreErrorCode = "blocked" | "corrupt" | "quota";

export class CisisProjectStoreError extends Error {
  readonly code: CisisProjectStoreErrorCode;

  constructor(code: CisisProjectStoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CisisProjectStoreError";
    this.code = code;
  }
}

const DATABASE_VERSION = 2;
const PROJECT_STORE = "projects";
const UPDATED_AT_INDEX = "updatedAt";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function copySnapshot(snapshot: CisisProjectSnapshot): CisisProjectSnapshot {
  if (snapshot.schemaVersion !== 1) {
    throw new Error(`Unsupported CISIS project schema: ${String(snapshot.schemaVersion)}`);
  }
  if (typeof snapshot.files !== "object" || snapshot.files === null || Array.isArray(snapshot.files)) {
    throw new Error("CISIS project files must be an object");
  }
  const paths = new Set<string>();
  return {
    schemaVersion: 1,
    files: Object.fromEntries(
      Object.entries(snapshot.files).map(([path, data]) => {
        if (!(data instanceof Uint8Array)) {
          throw new Error(`CISIS project file is not a Uint8Array: ${path}`);
        }
        const normalized = normalizeVirtualPath(path);
        if (paths.has(normalized)) {
          throw new Error(`Duplicate normalized CISIS project path: ${normalized}`);
        }
        paths.add(normalized);
        return [normalized, data.slice()];
      }),
    ),
  };
}

function quotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}

export class CisisProjectStore {
  readonly databaseName: string;
  #factory: IDBFactory;
  #database: Promise<IDBDatabase> | undefined;

  constructor(databaseName = "cisis-wasm-projects", factory?: IDBFactory) {
    if (factory === undefined && typeof indexedDB === "undefined") {
      throw new Error("IndexedDB is not available in this environment");
    }
    this.databaseName = databaseName;
    this.#factory = factory ?? indexedDB;
  }

  async save(name: string, snapshot: CisisProjectSnapshot): Promise<void> {
    if (!name.trim()) throw new Error("CISIS project name must not be empty");
    const database = await this.#open();
    const transaction = database.transaction(PROJECT_STORE, "readwrite");
    try {
      transaction.objectStore(PROJECT_STORE).put({
        ...copySnapshot(snapshot),
        name,
        updatedAt: Date.now(),
      } satisfies StoredProject);
      await transactionComplete(transaction);
    } catch (error) {
      if (quotaError(error) || quotaError(transaction.error)) {
        throw new CisisProjectStoreError(
          "quota",
          `IndexedDB quota was exceeded while saving CISIS project: ${name}`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  async load(name: string): Promise<CisisProjectSnapshot | undefined> {
    const database = await this.#open();
    const transaction = database.transaction(PROJECT_STORE, "readonly");
    const stored = await requestResult<StoredProject | undefined>(
      transaction.objectStore(PROJECT_STORE).get(name),
    );
    await transactionComplete(transaction);
    if (stored === undefined) return undefined;
    try {
      return copySnapshot(stored);
    } catch (error) {
      throw new CisisProjectStoreError(
        "corrupt",
        `Stored CISIS project is corrupt or unsupported: ${name}`,
        { cause: error },
      );
    }
  }

  async list(): Promise<string[]> {
    const database = await this.#open();
    const transaction = database.transaction(PROJECT_STORE, "readonly");
    const keys = await requestResult<IDBValidKey[]>(
      transaction.objectStore(PROJECT_STORE).getAllKeys(),
    );
    await transactionComplete(transaction);
    return keys.map(String).sort();
  }

  async delete(name: string): Promise<void> {
    const database = await this.#open();
    const transaction = database.transaction(PROJECT_STORE, "readwrite");
    transaction.objectStore(PROJECT_STORE).delete(name);
    await transactionComplete(transaction);
  }

  close(): void {
    void this.#database?.then((database) => database.close());
    this.#database = undefined;
  }

  #open(): Promise<IDBDatabase> {
    if (this.#database) return this.#database;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.#factory.open(this.databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const projects = request.result.objectStoreNames.contains(PROJECT_STORE)
          ? request.transaction!.objectStore(PROJECT_STORE)
          : request.result.createObjectStore(PROJECT_STORE, { keyPath: "name" });
        if (!projects.indexNames.contains(UPDATED_AT_INDEX)) {
          projects.createIndex(UPDATED_AT_INDEX, UPDATED_AT_INDEX);
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error ?? new Error("Failed to open CISIS project store"));
      request.onblocked = () => reject(
        new CisisProjectStoreError("blocked", "Opening CISIS project store was blocked"),
      );
    });
    this.#database = opening.catch((error: unknown) => {
      this.#database = undefined;
      throw error;
    });
    return this.#database;
  }
}
