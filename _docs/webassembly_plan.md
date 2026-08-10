# CISIS WebAssembly implementation plan

## Goal

Build a browser-compatible CISIS runtime that can power an in-browser test IDE
for PFT, FST, search expressions, and WXIS IsisScript. The first release should
run useful CISIS programs entirely in a Web Worker, without a server-side CISIS
installation, while returning deterministic output and diagnostics to the IDE.

The first compatibility target is the UTF-8 ISIS1660 configuration selected by
`compile_wxis.sh`, adapted to wasm32. In this codebase `SIXTY_FOUR=1` selects a
32-bit `LONGX`, so it is suitable for wasm32 but unsafe in a 64-bit native build
because formatter instruction nodes store pointers in `LONGX`:

```text
CIFFI=0 LIND=0 LIND4=0 ISISXL=1 ISISXL512=0
SIXTY_FOUR=1 _FILE_OFFSET_BITS=0 _LARGEFILE64_SOURCE=0
```

WebAssembly has a 32-bit address space in the initial implementation. The exact
record and database size limits must be measured and documented rather than
inferred from the misleadingly named native `SIXTY_FOUR` build flag.

## Current-state findings

- At the fork point, the repository had no automated build or test workflow.
  Native, 32-bit compatibility, package, and Emscripten jobs now run in GitHub
  Actions.
- Nine tracked files originally contained unresolved Git conflict markers,
  including `cisis.h`, `cifm3.c`, `mx.mak`, `wxis.mak`, and three WXIS source
  files. Those conflicts have been resolved and all profiles compile.
- The build is a collection of generated makefiles and shell scripts. It mixes
  configuration, compilation, and artifact copying and has no reusable library
  target.
- MX and WXIS are process-oriented entry points. They use global state, standard
  input/output, process environment variables, `exit`, and synchronous files.
- The formatter is embedded in the wider CISIS runtime rather than exposed as a
  small stable API. PFT support should initially reuse the proven engine through
  MX, then gain a narrow C wrapper after parity tests exist.
- The repository contains useful compatibility fixtures but few assertions:
  roughly one hundred IsisScript examples under `wxis_src/examples`, a CDS
  ISO/PFT/FST dataset, compiled CDS databases, and UTF-8 fixtures under
  `CISIS_UNI_Win/projects/mx/test`.
- Browser-incompatible or security-sensitive features are reachable from the
  current code: `system`, environment mutation, host directory traversal,
  sockets, and temporary-file helpers. Each needs an explicit policy.

## Implementation status

- **M0 native baseline:** MX and WXIS have isolated CMake targets. Native and
  32-bit ISIS1660 builds pass, including ISO import and golden PFT output.
- **M1 Emscripten executable:** Emscripten 6.0.4 produces modularized MX and
  WXIS ES modules with MEMFS. Both execute in CI under Node.
- **M2 browser runner:** the initial strict-TypeScript package serializes work
  through a module Worker, isolates each request, validates virtual paths and
  environment keys, captures output, returns selected files, classifies basic
  diagnostics, enforces resource limits, and replaces timed-out workers.
- **Browser verification:** headless Chromium loads the staged package with its
  default module URLs and executes both MX/PFT and WXIS.
- **M3 differential suite:** a data-driven runner now executes the same PFT,
  UTF-8, WXIS, ISO import, and database-read scenarios with native 32-bit and
  WebAssembly binaries. It compares status and narrowly normalized output,
  carries generated databases between steps, and publishes a checksum-bearing
  JSON report. The legacy-encoded ISO import's incidental record dump is kept
  in the report but excluded from text comparison because libc and Emscripten
  decode its invalid UTF-8 bytes differently; its generated database files are
  still compared byte-for-byte. Further examples can be promoted by extending
  the scenario list.
- **Next:** broaden M3 into FST/inverted-file search, database mutation, syntax
  errors, includes, and the remaining grouped repository examples.
- **IDE API bootstrap:** typed `format`, `index`, and `search` helpers now map
  validated requests onto the parity-tested MX runtime. They intentionally keep
  project persistence in the JavaScript host; a direct C ABI and IndexedDB
  project store remain M5 work.

## Architecture

### Build outputs

Produce one npm package with two layers:

1. `cisis-core.wasm` and generated Emscripten glue, built as an ES module.
2. A handwritten TypeScript API that owns workers, the virtual filesystem,
   input validation, output capture, cancellation, and structured diagnostics.

Start with a single module containing MX and WXIS to minimize source surgery.
Measure size and initialization time before deciding whether to split them. Pin
the Emscripten SDK version in a container and CI; do not depend on a developer's
global toolchain.

Use stable Emscripten modularized ES-module output, not the experimental
`MODULARIZE=instance` mode. Use the default MEMFS virtual filesystem initially.
The browser cannot access host files directly, and Emscripten maps normal libc
file operations to its virtual filesystem. Relevant upstream documentation:

- <https://emscripten.org/docs/compiling/Modularized-Output.html>
- <https://emscripten.org/docs/porting/files/file_systems_overview.html>
- <https://emscripten.org/docs/porting/emscripten-runtime-environment.html>

### Execution model

Run CISIS inside a dedicated Web Worker. The codebase is global-state-heavy and
not known to be reentrant, so executions are serialized within an instance.
Hard cancellation terminates the worker and creates a fresh instance. Do not add
pthreads initially: they add deployment header requirements without addressing
the current global-state design.

Each request gets an isolated virtual root such as `/work/<request-id>`. Uploaded
or generated files are copied into that root, arguments are normalized, and
path escape is rejected. MEMFS changes are returned explicitly to the caller.
Optional IndexedDB persistence can be added later at the TypeScript boundary.

### Public API

The low-level API preserves enough CLI behavior to execute existing examples:

```ts
type CisisRunRequest = {
  program: "mx" | "wxis";
  args: string[];
  files?: Record<string, Uint8Array | string>;
  env?: Record<string, string>;
  timeoutMs?: number;
  returnFiles?: string[];
};

type CisisRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  files: Record<string, Uint8Array>;
  diagnostics: CisisDiagnostic[];
  durationMs: number;
};
```

Add IDE-oriented helpers only after the runner is covered by parity tests:

```ts
format({ record, pft, tables }): Promise<FormatResult>
runIsisScript({ source, params, files }): Promise<CisisRunResult>
search({ database, expression, options }): Promise<SearchResult>
index({ database, fst, stopwords }): Promise<IndexResult>
```

Diagnostics should retain raw CISIS output and add a best-effort category,
message, source, line, and column. Do not promise precise PFT source locations
until the native parser can expose them reliably.

### Browser capability policy

Classify host-dependent behavior instead of silently emulating it:

| Capability | Initial browser policy |
| --- | --- |
| Database and format files | Supported through the per-request MEMFS root |
| Standard output and error | Captured and returned separately |
| Environment reads | Allowlisted request-local values only |
| Environment writes | Request-local and discarded after execution |
| Temporary files | Supported inside the request root with deterministic cleanup |
| Includes and `cat()` | Supported only for files inside the request root |
| `system()` and child processes | Disabled with a structured unsupported error |
| Raw sockets | Disabled; browser networking remains in the TypeScript host |
| Host filesystem paths | Rejected |
| Persistent database changes | Deferred; explicit export first, IndexedDB later |
| PFT-produced HTML | Returned as untrusted text; sanitization belongs to the IDE |

## Delivery milestones

### M0: recover a trustworthy native baseline

- Resolve all conflict markers from source history or a known good release; do
  not choose conflict sides solely because one compiles.
- Remove generated binaries and duplicate source trees from the build inputs.
- Add a small CMake or explicit GNU Make build for `mx-native` and `wxis-native`
  using one documented configuration.
- Build on Linux with warnings visible and AddressSanitizer/UndefinedBehaviorSanitizer
  jobs where the legacy code permits them.
- Record the exact compiler, flags, table files, and fixture checksums.
- Turn a minimal set of examples into golden native tests.

Exit criterion: a clean checkout builds both programs in CI and repeats the same
golden results twice.

### M1: first Emscripten executable

- Add a pinned Emscripten container and `CMakePresets.json` or equivalent build
  entry, with separate compile and link flags.
- Compile MX first because it exercises database I/O and PFT with less WXIS/CGI
  surface area.
- Fix portability errors behind a `CISIS_WASM` feature macro. Keep native code
  paths unchanged where possible.
- Replace process termination at the embedding boundary with returned status.
- Export only the wrapper entry points and the filesystem runtime methods needed
  by the host.
- Add debug and release artifacts; enable source maps and runtime assertions in
  debug builds.

Exit criterion: Node can instantiate the Wasm module, import the CDS fixture into
MEMFS, run MX, and reproduce native PFT output byte-for-byte.

### M2: browser-safe runner package

- Implement the TypeScript request/result contract and worker protocol.
- Capture stdout/stderr without shared global callbacks between requests.
- Add file upload/download helpers, path validation, UTF-8 conversion, resource
  limits, timeouts, worker replacement, and predictable cleanup.
- Normalize expected `exit` paths while preserving fatal errors as failed runs.
- Publish type declarations and a minimal framework-independent example.

Exit criterion: Chromium and Firefox run PFT examples without blocking the UI,
and timeout recovery leaves the next run usable.

### M3: differential compatibility suite

- Build a native fixture runner that emits a JSON manifest containing command,
  input checksums, exit code, stdout, stderr, and output-file checksums.
- Compare native and Wasm results. Normalize only proven platform variance such
  as path separators or timestamps; never broadly trim output.
- Promote repository examples into named test groups:
  - PFT literals, modes, selectors, subfields, missing fields, repetitions,
    functions, includes, and syntax errors;
  - UTF-8 accents, combining characters, non-Latin text, upper/lower tables,
    and invalid byte sequences;
  - ISO import/export and MST/XRF record reads;
  - FST generation and inverted-file search;
  - database create, update, delete, sort, and multi-step inversion;
  - IsisScript flow, fields, loops, parameters, includes, XML, and error paths.
- Seed the suite from `wxis_src/examples/cds`, the compiled `cdsx` fixture, and
  `CISIS_UNI_Win/projects/mx/test`. Copy selected fixtures into a single canonical
  test-data directory instead of testing duplicated trees.
- Add focused hand-written PFT records for present, absent, and repeated fields.
- Add fuzz smoke tests for the PFT and search parsers after sanitizer builds are
  stable.

Exit criterion: the supported matrix is published, all supported cases have
native/Wasm parity, and exclusions carry a reason rather than being skipped
silently.

### M4: WXIS IsisScript

- Compile the WXIS entry point and feed CGI-like parameters through request-local
  input rather than the browser's real process environment.
- Start with `hello.xis`, `format.xis`, `fieldocc.xis`, includes, CDS listing, and
  search examples.
- Introduce adapters for file copy/delete, temporary files, and environment
  fields. Reject shell execution and socket tasks at compile and runtime.
- Convert known WXIS error strings into structured diagnostics without changing
  stdout compatibility.
- Document exactly which IsisScript elements and tasks work in-browser.

Exit criterion: representative formatting, search, and update IsisScripts match
native WXIS; unsupported host operations fail explicitly and safely.

### M5: direct IDE APIs and persistence

- Add the narrow C ABI needed by `format`, `search`, and `index`; avoid exposing
  internal C structs or allocator ownership to JavaScript.
- Define a serializable record model that preserves repeated fields, subfields,
  byte content, and MFN/status metadata.
- Add optional project snapshots and IndexedDB persistence in the TypeScript
  layer, with import/export of all database companion files.
- Measure cold start, repeat-run latency, peak memory, fixture upload time, and
  artifact sizes. Establish budgets from measurements and representative IDE
  projects.

Exit criterion: the IDE can edit a PFT or IsisScript, execute it against an
uploaded or sample database, display diagnostics, and export all changed files.

### M6: hardening and release

- Test current Chromium, Firefox, and WebKit in Playwright at desktop and mobile
  viewport sizes; execution remains in a worker on all platforms.
- Run native and Wasm tests in GitHub Actions and publish checksummed npm and Wasm
  artifacts from tags.
- Generate an SPDX software bill of materials and preserve LGPL-2.1 notices,
  source availability, and relinking requirements in the release process.
- Review memory limits, malicious file names, decompression bombs, infinite
  scripts, generated HTML handling, and denial-of-service behavior.
- Version the compatibility matrix independently from the JavaScript API.

Exit criterion: reproducible tagged release, browser matrix green, documented
limits, license obligations met, and a sample IDE integration consuming only the
public package API.

## Test and CI layout

```text
wasm/
  CMakeLists.txt
  Dockerfile
  include/cisis_wasm.h
  src/cisis_wasm.c
packages/cisis-wasm/
  src/index.ts
  src/worker.ts
  test/
tests/
  fixtures/
    cds/
    pft/
    utf8/
    wxis/
  golden/
  native/
  browser/
```

Recommended CI jobs:

1. Native Linux build plus golden tests.
2. Native sanitizer build plus parser smoke tests.
3. Pinned Emscripten debug and release builds.
4. Node differential tests against the Wasm package.
5. Playwright browser tests served with production-like headers.
6. Artifact-size and exported-symbol checks to catch accidental API growth.

Generated outputs must include provenance: source commit, Emscripten version,
build configuration, and fixture manifest version.

## Initial compatibility matrix

| Area | First release | Later or excluded |
| --- | --- | --- |
| PFT formatting | Full parity for covered UTF-8 fixtures | Undocumented dialect extensions remain test-driven |
| IsisScript | Flow, formatting, files, DB read/search/update | Shell and socket operations excluded |
| FST/indexing | In-memory generation and search | Very large databases after measurement |
| Database formats | ISIS1660 MST/XRF and companion index files | Other layout variants after fixture coverage |
| Persistence | Explicit file import/export | IndexedDB project storage in M5 |
| Concurrency | One serialized runtime per worker | Worker pool only after memory measurement |
| Networking | JavaScript host fetches files before execution | Native socket compatibility excluded |

## Main risks and controls

- **Unknown source provenance:** resolve conflict markers against a known build or
  upstream history and preserve a baseline tag.
- **Undefined behavior hidden by old compilers:** use warnings, sanitizers, and
  differential fixtures before changing types or layouts.
- **Binary format assumptions:** assert type sizes and endianness at compile time;
  test byte-level database round trips.
- **Global state and fatal exits:** isolate in workers first, then add a narrow C
  context API only where tests justify the refactor.
- **Filesystem semantics:** keep all paths virtual and request-scoped; test every
  multi-file database operation.
- **False confidence from examples:** examples become tests only after expected
  status, output, and file mutations are captured.
- **Browser lockups:** worker execution, timeouts, memory ceilings, and worker
  replacement are part of the API contract.
- **Scope expansion:** PFT and database reads land before full WXIS, indexing,
  persistence, or an IDE UI.

## Definition of done for the end goal

The WebAssembly work is complete enough for an in-browser test IDE when:

- users can provide a record/database plus PFT, FST, search expression, or
  IsisScript and run it without a backend;
- output, errors, diagnostics, and generated files are returned through a typed
  worker API;
- supported behavior is checked against the same native commit and published in
  a compatibility matrix;
- UTF-8, repeatable fields, database reads/searches/updates, and representative
  WXIS flows are covered in real browsers;
- unsafe host capabilities are unavailable and report actionable errors;
- runs can be cancelled without reloading the page; and
- release artifacts are reproducible, versioned, documented, and LGPL-compliant.
