import assert from "node:assert/strict";
import test from "node:test";

import { executeRequest, type ModuleLoader } from "./worker-runtime.js";

test("executes in an isolated filesystem and returns requested files", async () => {
  const files = new Map<string, Uint8Array>();
  let cwd = "/";
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const loadModule: ModuleLoader = async () => ({
    default: async ({ print }) => ({
      ENV: {},
      FS: {
        analyzePath: (path) => ({ exists: files.has(path) }),
        chdir: (path) => { cwd = path; },
        mkdir: () => undefined,
        mkdirTree: () => undefined,
        readFile: (path) => files.get(path) ?? new Uint8Array(),
        writeFile: (path, data) => {
          files.set(path, typeof data === "string" ? encoder.encode(data) : data);
        },
      },
      callMain: (args) => {
        print(args.join(" "));
        files.set(`${cwd}/result.txt`, encoder.encode("done"));
        return 0;
      },
    }),
  });

  const result = await executeRequest(
    7,
    "mock-module.mjs",
    {
      program: "mx",
      args: ["seq=input.txt", "pft=v1/"],
      files: { "fixtures/input.txt": "hello" },
      returnFiles: ["result.txt"],
      inspectFiles: ["result.txt", "missing.txt"],
    },
    loadModule,
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "seq=input.txt pft=v1/");
  assert.equal(decoder.decode(result.files["result.txt"]), "done");
  assert.deepEqual(result.fileStates, { "result.txt": true, "missing.txt": false });
  assert.equal(decoder.decode(files.get("/work/7/fixtures/input.txt")), "hello");
});

test("limits captured runtime output", async () => {
  const loadModule: ModuleLoader = async () => ({
    default: async ({ print }) => ({
      FS: {
        analyzePath: () => ({ exists: false }),
        chdir: () => undefined,
        mkdir: () => undefined,
        mkdirTree: () => undefined,
        readFile: () => new Uint8Array(),
        writeFile: () => undefined,
      },
      callMain: () => {
        print("output beyond limit");
        return 0;
      },
    }),
  });

  const result = await executeRequest(
    8,
    "mock-module.mjs",
    { program: "mx", args: [], maxOutputBytes: 4 },
    loadModule,
  );
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /output exceeded 4 bytes/);
});

test("reports a missing requested output without leaking filesystem errors", async () => {
  const loadModule: ModuleLoader = async () => ({
    default: async () => ({
      FS: {
        analyzePath: () => ({ exists: false }),
        chdir: () => undefined,
        mkdir: () => undefined,
        mkdirTree: () => undefined,
        readFile: () => { throw { errno: 44 }; },
        writeFile: () => undefined,
      },
      callMain: () => 0,
    }),
  });

  await assert.rejects(
    executeRequest(
      9,
      "mock-module.mjs",
      { program: "mx", args: [], returnFiles: ["missing.bin"] },
      loadModule,
    ),
    /did not create requested file: missing.bin/,
  );
});
