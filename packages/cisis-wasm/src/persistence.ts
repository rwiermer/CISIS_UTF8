import type { CisisProjectSnapshot } from "./project.js";
import { normalizeVirtualPath } from "./path.js";

interface StoredProject extends CisisProjectSnapshot {
  name: string;
  updatedAt: number;
}

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
  return {
    schemaVersion: 1,
    files: Object.fromEntries(
      Object.entries(snapshot.files).map(([path, data]) => {
        if (!(data instanceof Uint8Array)) {
          throw new Error(`CISIS project file is not a Uint8Array: ${path}`);
        }
        return [normalizeVirtualPath(path), data.slice()];
      }),
    ),
  };
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
    const transaction = database.transaction("projects", "readwrite");
    transaction.objectStore("projects").put({
      ...copySnapshot(snapshot),
      name,
      updatedAt: Date.now(),
    } satisfies StoredProject);
    await transactionComplete(transaction);
  }

  async load(name: string): Promise<CisisProjectSnapshot | undefined> {
    const database = await this.#open();
    const transaction = database.transaction("projects", "readonly");
    const stored = await requestResult<StoredProject | undefined>(
      transaction.objectStore("projects").get(name),
    );
    await transactionComplete(transaction);
    return stored === undefined ? undefined : copySnapshot(stored);
  }

  async list(): Promise<string[]> {
    const database = await this.#open();
    const transaction = database.transaction("projects", "readonly");
    const keys = await requestResult<IDBValidKey[]>(
      transaction.objectStore("projects").getAllKeys(),
    );
    await transactionComplete(transaction);
    return keys.map(String).sort();
  }

  async delete(name: string): Promise<void> {
    const database = await this.#open();
    const transaction = database.transaction("projects", "readwrite");
    transaction.objectStore("projects").delete(name);
    await transactionComplete(transaction);
  }

  close(): void {
    void this.#database?.then((database) => database.close());
    this.#database = undefined;
  }

  #open(): Promise<IDBDatabase> {
    if (this.#database) return this.#database;
    this.#database = new Promise((resolve, reject) => {
      const request = this.#factory.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("projects")) {
          request.result.createObjectStore("projects", { keyPath: "name" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Failed to open CISIS project store"));
      request.onblocked = () => reject(new Error("Opening CISIS project store was blocked"));
    });
    return this.#database;
  }
}
