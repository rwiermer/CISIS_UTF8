# WebAssembly compatibility matrix

## Scope and baseline

This document records behavior verified for the browser-targeted ISIS1660 UTF-8
configuration. It is a tested subset of CISIS, not a claim that every MX option,
PFT extension, FST technique, or IsisScript task works in a browser.

- Package version: `0.1.0-dev` (private preview).
- Validated implementation: commit
  [`0e774e6`](https://github.com/rwiermer/CISIS_UTF8/commit/0e774e62aec5af152da3307a23d72cb68eb19bc8).
- Toolchain: Emscripten 6.0.4, wasm32, 32-bit `LONGX`.
- Native parity oracle: the same commit built as 32-bit Linux ISIS1660.
- Green reference: GitHub Actions run
  [`31410507361`](https://github.com/rwiermer/CISIS_UTF8/actions/runs/31410507361),
  2026-08-10.
- Browser currently tested in CI: headless Chromium.

## Runtime and API

| Capability | State | Current behavior |
| --- | --- | --- |
| Low-level execution | Verified | `run()` invokes MX or WXIS in a module Worker and returns status, stdout, stderr, diagnostics, duration, requested files, and inspected file-presence states. |
| PFT formatting helper | Verified | `format()` runs a PFT against caller-supplied ISIS1660 database files. |
| Structured record formatting | Verified in Chromium/native-Wasm parity | `formatRecord()` preserves ordered and repeated fields, UTF-8 values, and PFT subfield syntax while importing one active record as MFN 1. |
| FST indexing helper | Verified | `index()` performs full inversion and returns `.cnt`, `.ifp`, `.l01`, `.l02`, `.n01`, and `.n02`. |
| Search helper | Verified | `search()` executes an MX Boolean expression against supplied database and index files. |
| IsisScript helper | Verified subset | `runIsisScript()` maps source, parameters, and files to request-local WXIS arguments. |
| Project workspace | Verified | `CisisProject` retains host-side files, absorbs returned outputs, and removes retained files inspected as absent after a run. |
| Project snapshots | Verified | Snapshots use schema version 1 and defensive `Uint8Array` copies. |
| IndexedDB persistence | Verified in Chromium | `CisisProjectStore` supports save, load, list, delete, and close. |
| Portable project archive | Verified in Chromium | Deterministic binary archives preserve arbitrary file bytes without base64 and reject corrupt, oversized, duplicate, or escaping entries. |
| Direct C API | Not implemented | IDE helpers currently translate to validated MX/WXIS command arguments. |
| Serializable record model | Partial | Ordered fields accept text or byte values. Arbitrary MFNs, deleted status, multiple records, and database mutation are not yet represented. |

## Language and workflow coverage

| Area | State | Verified coverage | Important gaps |
| --- | --- | --- | --- |
| PFT | Supported subset | literals, MFN, field/subfield selection, missing/repeated fields, uppercase mode, `nocc`, `size`, `left`, combining/non-Latin UTF-8, and one fatal syntax error | other modes, broader functions/includes, and more errors need focused cases |
| IsisScript flow | Supported subset | display, fields, loops, CGI parameters, and nested includes | broader flow/error examples and precise source diagnostics |
| IsisScript database work | Supported subset | ISO import/export, update writes, database reads, file deletion, Boolean search, and malformed-search reporting | record deletion, sort, XML conversion, and temporary-file workflows |
| Database format | Supported subset | ISO2709 import/export and current ISIS1660 MST/XRF creation and reads | other historical layouts, large databases, deleted records, and endian portability |
| FST and inversion | Supported subset | bundled CDS techniques 0, 2, and 4; full inversion through the in-process CISIS sorter | other techniques, stopword/table variants, and incremental inversion |
| Search | Supported subset | MX and WXIS Boolean retrieval, a compound `AND`, and one WXIS malformed-expression path | broader syntax-error matrix, prefixes, sets, logs, and larger result sets |
| UTF-8 | Supported subset | combining characters plus asserted Polish, Japanese, and Greek output | table-driven case conversion and deliberately invalid byte sequences |

## Differential scenarios

Eleven scenarios currently execute against both native 32-bit and Wasm builds:

1. UTF-8 sequence input and PFT output.
2. Polish, Japanese, and Greek PFT output.
3. WXIS hello/display output.
4. WXIS field definition and loop control.
5. WXIS nested includes and calls.
6. Fatal PFT syntax error with structured format diagnostics.
7. Structured active-record import and PFT formatting, including repeated fields,
   UTF-8, and subfields.
8. WXIS file deletion and inspected post-run file state.
9. ISO import/export, database reads, and PFT missing/repeated fields,
   subfields, uppercase mode, and functions.
10. ISO import, FST full inversion, simple/compound MX search, WXIS search, and
   malformed search.
11. WXIS ISO import/update followed by an MX database read.

The differential runner compares exit status, stdout, stderr, and requested
output-file SHA-256 checksums. It normalizes CRLF to LF and removes one terminal
LF because Emscripten delivers output through line callbacks. The fatal parser
case additionally normalizes terminal stderr newlines because native stdio and
the callback transport preserve different counts. Generated ISO, MST/XRF, and
all six inverted-file companions match the native 32-bit build byte-for-byte in
covered scenarios. CI publishes the JSON report with the Wasm artifact.

## Browser execution and limits

| Concern | Current behavior |
| --- | --- |
| Isolation | Every request uses a fresh Emscripten module and a separate MEMFS root. |
| Scheduling | One `CisisRunner` serializes requests through one Worker. |
| Cancellation | A timeout terminates and replaces the Worker; the next queued request can continue. |
| Paths | Mapped input/output paths and helper database names reject empty, absolute, drive-qualified, and request-root-escaping values. Low-level CLI arguments are not parsed. |
| Environment | Only allowlisted request-local keys are accepted; defaults are `CIPAR`, `LANG`, `LC_ALL`, `QUERY_STRING`, and `REQUEST_METHOD`. |
| Default timeout | 5 seconds. |
| Default input limit | 64 MiB per request. |
| Default captured output limit | 4 MiB per request. |
| Default returned-file limit | 64 MiB per request. |
| Wasm memory | 64 MiB initial memory, growth enabled, 256 MiB maximum. |
| HTML | PFT/WXIS HTML is returned as untrusted text; sanitization belongs to the IDE. |

## Unsupported and unverified host behavior

| Capability | State |
| --- | --- |
| Host filesystem paths | The browser host filesystem is unavailable. Mapped file paths and helper database names are rejected at the TypeScript boundary; arbitrary low-level CLI arguments remain a documented hardening boundary. |
| Child processes and shell commands | Not part of the supported browser API. Full inversion no longer needs host `sort`; explicit structured rejection for every remaining legacy `system()` path is not yet verified. |
| Raw sockets | Not part of the supported browser API; networking must be performed by JavaScript before execution. |
| Temporary files | MEMFS can provide request-local files, but representative IsisScript temporary-file cases are not yet in the differential suite. |
| Persistent Wasm filesystem | Not used. Persistence is explicit in the JavaScript project layer and IndexedDB store. |

## Known variance

The bundled CDS ISO fixture contains bytes that are not valid UTF-8. Native libc
and Emscripten produce different replacement characters when MX prints the
entire import stream. That incidental import stdout is retained in the JSON
report but excluded from string comparison. Exit status, stderr, generated
MST/XRF checksums, and subsequent selected PFT output remain compared.

## Remaining release work

- Add more PFT/search syntax-error cases and invalid-byte fixtures.
- Cover database record deletion, sort, and incremental inversion.
- Cover IsisScript XML, temporary files, and unsupported-operation errors.
- Add Firefox and WebKit Playwright jobs.
- Measure cold start, repeated-run latency, memory, upload time, and artifact size.
- Define IndexedDB migration, quota, corruption, and multi-tab behavior.
- Extend structured records to MFN/status-preserving multi-record database edits.
- Add sanitizer builds, fuzz smoke tests, release provenance, checksums, SBOM,
  and LGPL source/relinking deliverables.
