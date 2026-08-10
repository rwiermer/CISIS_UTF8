import assert from "node:assert/strict";
import test from "node:test";

import { CisisProjectStore, CisisProjectStoreError } from "./persistence.js";

test("reports unavailable IndexedDB outside a browser", () => {
  if (typeof indexedDB === "undefined") {
    assert.throws(() => new CisisProjectStore(), /IndexedDB is not available/);
  }
});

test("classifies IndexedDB quota failures", async () => {
  const quota = new DOMException("storage full", "QuotaExceededError");
  const transaction = {
    error: null as DOMException | null,
    objectStore: () => ({
      put: () => queueMicrotask(() => {
        transaction.error = quota;
        transaction.onerror?.(new Event("error"));
      }),
    }),
    oncomplete: null as ((event: Event) => void) | null,
    onerror: null as ((event: Event) => void) | null,
    onabort: null as ((event: Event) => void) | null,
  };
  const database = { transaction: () => transaction };
  const request = {
    result: database,
    error: null,
    onsuccess: null as ((event: Event) => void) | null,
    onerror: null as ((event: Event) => void) | null,
    onblocked: null as ((event: Event) => void) | null,
    onupgradeneeded: null as ((event: Event) => void) | null,
  };
  const factory = {
    open: () => {
      queueMicrotask(() => request.onsuccess?.(new Event("success")));
      return request;
    },
  } as unknown as IDBFactory;
  const store = new CisisProjectStore("quota-test", factory);

  await assert.rejects(
    store.save("demo", { schemaVersion: 1, files: {} }),
    (error) => error instanceof CisisProjectStoreError && error.code === "quota",
  );
});
