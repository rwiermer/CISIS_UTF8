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

## Baseline findings and current constraints

- At the fork point, the repository had no automated build or test workflow.
  Native, 32-bit compatibility, package, and Emscripten jobs now run in GitHub
  Actions.
- Nine tracked files originally contained unresolved Git conflict markers,
  including `cisis.h`, `cifm3.c`, `mx.mak`, `wxis.mak`, and three WXIS source
  files. Those conflicts have been resolved and all profiles compile.
- The legacy build remains a collection of generated makefiles and shell
  scripts, but CMake is now the supported entry point for native, native-32, and
  Wasm targets. There is not yet a reusable CISIS library target.
- MX and WXIS are process-oriented entry points. They use global state, standard
  input/output, process environment variables, `exit`, and synchronous files.
- The formatter is embedded in the wider CISIS runtime and remains behind the
  parity-tested MX boundary. Current measurements do not justify a formatter C
  wrapper; the only direct ABI is the record export needed for deleted records.
- The repository contains roughly one hundred IsisScript examples, a CDS
  ISO/PFT/FST dataset, compiled databases, and UTF-8 fixtures. Twelve workflows
  are now differential scenarios; most examples have not yet been promoted to
  asserted tests.
- Browser-incompatible or security-sensitive features are reachable from the
  current code: `system`, environment mutation, host directory traversal,
  sockets, and temporary-file helpers. Each needs an explicit policy.

## Implementation status

The implementation is at an M5/M6 preview. It supports useful browser workflows,
but it is not yet a hardened or published release.

| Milestone | State | Current result |
| --- | --- | --- |
| M0 native baseline | Operational | Separate MX and WXIS CMake targets build on native 64-bit and native 32-bit Linux; the 32-bit build is the Wasm parity oracle. |
| M1 Emscripten executable | Operational | Pinned Emscripten 6.0.4 produces separate modularized ES modules for MX and WXIS with MEMFS. |
| M2 browser runner | Operational | Strict-TypeScript Worker runner, isolation, validation, limits, cancellation by Worker replacement, returned files, and basic diagnostics are implemented. The packaged Worker workflow passes in Chromium, Firefox, and WebKit. |
| M3 differential suite | Partial | Twelve data-driven scenarios cover exact combining and non-Latin UTF-8, PFT subfields/modes/functions/missing/repeated fields, structured record formatting and database writes, logical deletion, PFT and search errors, WXIS flow/includes, ISO import/export, database reads/updates, file deletion, full inversion, and simple/compound search. More mutation and parser cases remain. |
| M4 WXIS IsisScript | Partial | Hello/display, fields, loops, CGI parameters, includes, database import/export/update, file deletion, and search match native behavior in covered cases. Other host operations, temporary files, and XML remain to be classified and tested. |
| M5 IDE APIs and persistence | Partial | CLI-backed helpers, active/deleted structured readback through one narrow C export, MFN/status-preserving writes, legacy FDT parsing/record validation, optimistic project revisions, snapshots, IndexedDB migration/typed failures, deterministic archives, a public-API playground, performance reporting, and artifact budgets are implemented. Quota recovery, multi-tab behavior, and broader browser performance budgets remain. |
| M6 hardening and release | Partial | CI runs the packaged Worker and playground workflows in desktop Chromium, Firefox, and WebKit plus mobile Chromium/WebKit viewports, enforces Wasm artifact budgets, publishes compatibility/performance reports, and can deploy the playground to GitHub Pages. Sanitizer/fuzz jobs, release packaging, SBOM/license deliverables, security review, and reproducibility checks remain. |

The current green reference is implementation commit
[`ee9220e`](https://github.com/rwiermer/CISIS_UTF8/commit/ee9220e0a8c2016679a65b2cd7fd63f3a95f9f2e),
validated by GitHub Actions run
[`31421539863`](https://github.com/rwiermer/CISIS_UTF8/actions/runs/31421539863)
on 2026-08-10.

The interactive playground is deployed at
<https://rwiermer.github.io/CISIS_UTF8/> by Pages run
[`31421539903`](https://github.com/rwiermer/CISIS_UTF8/actions/runs/31421539903).

### Next priorities

1. Close the remaining M3/M4 correctness gaps with additional PFT/search parser
   failures, invalid-byte cases, database sort and incremental inversion, WXIS
   temporary files/XML, and explicit unsupported-host-operation tests.
2. Complete M5 with IndexedDB quota recovery and multi-tab behavior, then extend
   measurements to browser cold start, memory, and large databases. Keep the C
   ABI limited to record readback unless further measurements justify expansion.
3. Continue M6 with sanitizer/fuzz jobs, reproducible release metadata, SBOM
   generation, and LGPL deliverables.

## Architecture

### Build outputs

The build produces one npm package with two layers:

1. Separate `cisis-mx.wasm` and `cisis-wxis.wasm` binaries with modularized ES
   module glue.
2. A handwritten TypeScript API that owns workers, the virtual filesystem,
   input validation, output capture, cancellation, and structured diagnostics.

The modules remain separate because MX and WXIS have independent legacy entry
points and source sets. Initialization time and the size trade-off versus a
shared core have not yet been measured. CI pins Emscripten 6.0.4.

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
files and requested output paths are normalized and path escape is rejected;
database names used by the high-level helpers receive equivalent validation.
Low-level CLI argument strings are preserved for CISIS compatibility and are not
parsed as paths. They cannot access the browser host filesystem, but a stricter
virtual-root policy for those arguments remains hardening work. MEMFS changes
are returned explicitly to the caller.
`CisisProject` retains explicitly returned files in the JavaScript host and
resubmits them to later isolated runs. Versioned project snapshots can be saved
to IndexedDB through `CisisProjectStore`; the Wasm module itself does not mount
or depend on IndexedDB.

### Public API

The low-level API preserves enough CLI behavior to execute existing examples:

```ts
type CisisRunRequest = {
  program: "mx" | "wxis";
  args: string[];
  files?: Record<string, Uint8Array | string>;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxReturnedFileBytes?: number;
  returnFiles?: string[];
  inspectFiles?: string[];
};

type CisisRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  files: Record<string, Uint8Array>;
  fileStates: Record<string, boolean>;
  diagnostics: CisisDiagnostic[];
  durationMs: number;
};
```

The package also exposes CLI-backed IDE helpers:

```ts
format({ database, pft, files, from, count }): Promise<CisisRunResult>
formatRecord({ record, pft }): Promise<CisisRunResult>
writeRecords({ database, records, files, replace }): Promise<CisisRunResult>
readRecords({ database, files, from, count }): Promise<CisisReadRecordsResult>
runIsisScript({ source, params, files }): Promise<CisisRunResult>
search({ database, expression, pft, files, from, count }): Promise<CisisRunResult>
index({ database, fst, files, index }): Promise<CisisRunResult>

const project = runner.createProject(files)
project.snapshot(): CisisProjectSnapshot
project.revision: number
project.writeRecords({ database, records, expectedRevision }): Promise<CisisRunResult>
project.exportArchive(): Uint8Array
CisisProject.fromArchive(runner, archive): CisisProject
store.save(name, snapshot): Promise<void>
store.load(name): Promise<CisisProjectSnapshot | undefined>
```

Formatting, writing, indexing, search, and IsisScript helpers translate to
validated MX/WXIS arguments. Structured reads use one narrow C function because
MX ISO export omits deleted records; its versioned stream copies MFN, status,
tags, and bytes without exposing C structs or allocator ownership. Diagnostics
retain raw output and provide a best-effort category, message, and severity.
Source, line, and column are not implemented because the native parsers do not
expose them reliably.

### Current browser capability policy

Classify host-dependent behavior instead of silently emulating it:

| Capability | Initial browser policy |
| --- | --- |
| Database and format files | Supported through the per-request MEMFS root |
| Standard output and error | Captured and returned separately |
| Environment reads | Allowlisted request-local values only |
| Environment writes | Request-local and discarded after execution |
| Temporary files | Available in request-local MEMFS; representative WXIS cases still need tests |
| Includes and `cat()` | Supported only for files inside the request root |
| `system()` and child processes | Unsupported; full inversion uses an in-process sorter, but explicit rejection coverage remains |
| Raw sockets | Unsupported; browser networking remains in the TypeScript host |
| Host filesystem paths | Unavailable; mapped file paths and helper database names are rejected, while low-level CLI arguments remain unparsed |
| Persistent database changes | Explicit returned files retained by `CisisProject`; optional IndexedDB snapshots |
| PFT-produced HTML | Returned as untrusted text; sanitization belongs to the IDE |

## Delivery milestones

### M0: recover a trustworthy native baseline

**Status: operational, with repository cleanup, sanitizer, and provenance work
remaining.**

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

**Status: operational.** MX and WXIS both build and run. The implementation
uses two modules rather than the originally proposed combined module. Debug
Wasm artifacts, source-map coverage, and containerized toolchain packaging
remain.

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

**Status: operational.** The runner contract, Worker isolation, validation,
limits, timeouts, and Playwright coverage in Chromium, Firefox, and WebKit are
implemented.

- Implement the TypeScript request/result contract and worker protocol.
- Capture stdout/stderr without shared global callbacks between requests.
- Add file upload/download helpers, path validation, UTF-8 conversion, resource
  limits, timeouts, worker replacement, and predictable cleanup.
- Normalize expected `exit` paths while preserving fatal errors as failed runs.
- Publish type declarations and a minimal framework-independent example.

Exit criterion: Chromium and Firefox run PFT examples without blocking the UI,
and timeout recovery leaves the next run usable.

### M3: differential compatibility suite

**Status: partial.** The runner and published compatibility matrix exist. The
current twelve scenarios cover the main database/index/search path, but not the
full example groups listed below.

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

**Status: partial.** Representative flow, includes, import/export/update, file
deletion, search, and error behavior are covered. Temporary files, XML, and
explicit rejection of unsupported host operations remain.

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

**Status: partial.** Database-oriented TypeScript helpers, active single-record
formatting, active/deleted structured readback, MFN/status-preserving database
writes, automatic stale-index invalidation, optimistic project revisions,
versioned snapshots, IndexedDB v1-to-v2 migration, typed storage failures,
deterministic archives, and initial performance/artifact budgets are implemented.
Quota recovery, multi-tab behavior, browser memory/cold-start measurements, and
large-database measurements remain.

- Keep the direct ABI limited to its versioned record-read stream unless measured
  CLI performance or diagnostics justify another function; do not expose
  internal C structs or allocator ownership to JavaScript.
- Preserve active and deleted record readback coverage across binary fields,
  repeated fields, subfields, and sparse MFNs.
- Harden the implemented IndexedDB layer with quota recovery, corruption UX,
  and multi-tab coordination while retaining explicit companion-file exports.
- Extend the initial Node timing and artifact report with browser cold start,
  peak memory, fixture upload time, and representative large IDE projects.

Exit criterion: the IDE can edit a PFT or IsisScript, execute it against an
uploaded or sample database, display diagnostics, and export all changed files.

### M6: hardening and release

**Status: partial.** Chromium, Firefox, and WebKit Worker coverage, mobile
Chromium/WebKit viewport coverage, a deployable public-API playground, artifact
ceilings, and compatibility/performance reports run in CI. Security, provenance,
and release work remains.

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

The current repository has:

```text
packages/cisis-wasm/       TypeScript API, Worker, project storage, and tests
demo/                      static PFT/FST/search/WXIS/FDT/MX playground
scripts/build-pages.mjs    deterministic Pages artifact staging
tests/native/              native compatibility smoke test
tests/wasm/                generated-module and packaged-runtime smoke tests
tests/compat/              data-driven native/Wasm differential scenarios
tests/browser/             browser fixture page and static test server
.github/workflows/         build/test and GitHub Pages deployment jobs
```

CI currently builds native 64-bit, native 32-bit, and pinned Emscripten targets;
runs package unit tests; stages the Wasm package; compares native 32-bit and
Wasm results; runs desktop Chromium, Firefox, and WebKit plus mobile
Chromium/WebKit viewports through Playwright; exercises the interactive
playground; enforces artifact budgets; and uploads Wasm modules, the package
distribution, and differential/performance JSON reports. A separate workflow
builds the pinned Wasm runtime and deploys the staged playground to GitHub Pages.

Still required are sanitizer jobs, Emscripten debug artifacts, exported-symbol
budget checks, and complete artifact provenance.

## Current compatibility summary

The detailed evidence and exclusions are maintained in
[`webassembly_compatibility.md`](webassembly_compatibility.md).

| Area | First release | Later or excluded |
| --- | --- | --- |
| PFT formatting | Parity for covered combining/non-Latin UTF-8, subfields, modes, functions, missing/repeated fields, and one syntax error | More functions/errors and undocumented extensions remain test-driven |
| IsisScript | Flow, includes, DB import/read/search/update | XML, temporary-file, error, shell, and socket cases remain |
| FST/indexing | Full inversion and search for bundled CDS FST; realistic playground index with title/author/subject/place/publisher/year namespaces and general discovery terms | Other techniques, incremental inversion, and large databases |
| Database formats | ISIS1660 MST/XRF and companion index files; active/deleted structured readback, MFN/status-preserving writes, and host-side legacy FDT validation | Other layout variants and FDT-driven legacy XML conversion after fixture coverage |
| Persistence | Host-managed files, versioned snapshots, IndexedDB schema migration and typed failures, deterministic import/export archive | Quota budgets/recovery and multi-tab coordination |
| Concurrency | One serialized runtime per worker | Worker pool only after memory measurement |
| Networking | JavaScript host fetches files before execution | Native socket compatibility excluded |

## Main risks and controls

- **Unknown source provenance:** resolve conflict markers against a known build or
  upstream history and preserve a baseline tag.
- **Undefined behavior hidden by old compilers:** use warnings, sanitizers, and
  differential fixtures before changing types or layouts.
- **Binary format assumptions:** assert type sizes and endianness at compile time;
  test byte-level database round trips.
- **Global state and fatal exits:** retain Worker isolation and keep the current
  C ABI limited to the versioned record export unless tests justify expansion.
- **Filesystem semantics:** keep all paths virtual and request-scoped; test every
  multi-file database operation.
- **False confidence from examples:** examples become tests only after expected
  status, output, and file mutations are captured.
- **Browser lockups:** worker execution, timeouts, memory ceilings, and worker
  replacement are part of the API contract.
- **Scope expansion:** keep compatibility evidence ahead of new WXIS surface,
  direct C APIs, and an IDE UI.

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

The current preview satisfies the basic Worker execution, typed result,
database/PFT/FST/search, representative WXIS, cancellation, and project
persistence portions, including structured active/deleted record workflows and
initial artifact/performance budgets. The hosted playground supplies a working
public-API IDE integration for the main workflows. The preview does not yet
satisfy the required language breadth, explicit host-error coverage, browser
memory/latency budgets, persistence hardening, or release requirements.
