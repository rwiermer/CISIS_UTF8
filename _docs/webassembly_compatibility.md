# WebAssembly compatibility matrix

## Scope and baseline

This document records behavior verified for the browser-targeted ISIS1660 UTF-8
configuration. It is a tested subset of CISIS, not a claim that every MX option,
PFT extension, FST technique, or IsisScript task works in a browser.

- Package version: `0.1.0-dev` (private preview).
- Validated implementation: commit
  [`07c9ef6`](https://github.com/rwiermer/CISIS_UTF8/commit/07c9ef696c393f2b135e9006ce4a20bc16fae0dc).
- Toolchain: Emscripten 6.0.4, wasm32, 32-bit `LONGX`.
- Native parity oracle: the same commit built as 32-bit Linux ISIS1660.
- Green reference: GitHub Actions run
  [`31417403958`](https://github.com/rwiermer/CISIS_UTF8/actions/runs/31417403958),
  2026-08-10.
- Browsers tested in CI: headless desktop Chromium, Firefox, and WebKit, plus
  Pixel-class Chromium and iPhone-class WebKit viewports.
- Deployed playground: <https://rwiermer.github.io/CISIS_UTF8/>.

## Runtime and API

| Capability | State | Current behavior |
| --- | --- | --- |
| Low-level execution | Verified | `run()` invokes MX or WXIS in a module Worker and returns status, stdout, stderr, diagnostics, duration, requested files, and inspected file-presence states. |
| PFT formatting helper | Verified | `format()` runs a PFT against caller-supplied ISIS1660 database files. |
| Structured record formatting | Verified in Chromium, Firefox, WebKit, and native-Wasm parity | `formatRecord()` preserves ordered and repeated fields, UTF-8 values, and PFT subfield syntax while importing one active record as MFN 1. |
| Structured database writes | Verified in Chromium, Firefox, WebKit, and native-Wasm parity | `writeRecords()` creates or upserts up to 1,000 complete records with explicit MFNs and active/deleted status, then invalidates stale index companions. MFNs are limited to 1,000,000 and one field tag must be unused by the batch for transient import metadata. |
| Structured database reads | Verified in Node, Chromium, Firefox, and WebKit | `readRecords()` uses a versioned direct C export to return active and logically deleted records with explicit MFNs, ordered/repeated tags, and byte-valued fields. Reads default to and are limited to 1,000 records per call. |
| FST indexing helper | Verified | `index()` performs full inversion and returns `.cnt`, `.ifp`, `.l01`, `.l02`, `.n01`, and `.n02`. |
| Search helper | Verified | `search()` executes an MX Boolean expression against supplied database and index files. |
| IsisScript helper | Verified subset | `runIsisScript()` maps source, parameters, and files to request-local WXIS arguments. |
| Project workspace | Verified | `CisisProject` retains host-side files, serializes mutations, makes reads wait for queued writes, exposes a session-local revision, rejects stale optimistic writes, and discards results after overlapping host edits. |
| Project snapshots | Verified | Snapshots use schema version 1 and defensive `Uint8Array` copies. |
| IndexedDB persistence | Verified in Chromium, Firefox, and WebKit | `CisisProjectStore` supports save, load, list, delete, and close; v1 databases migrate to v2 with binary data intact, and blocked/corrupt/quota failures have typed codes. |
| Portable project archive | Verified in Chromium, Firefox, and WebKit | Deterministic binary archives preserve arbitrary file bytes without base64 and reject corrupt, oversized, duplicate, or escaping entries. |
| Direct C API | Verified narrow export | One MX-only function writes a versioned record stream to MEMFS. It exposes no internal structs or allocator ownership and exists specifically because ISO export omits deleted records. |
| Serializable record model | Verified subset | Ordered fields accept text or byte values; writes and reads preserve repeated fields, explicit MFNs, and logical deletion, and project revisions prevent silent lost updates. Reads/writes are bounded to 1,000 records per call. |
| Interactive playground | Verified in browser matrix | The static public-API client edits demo records and FDT schemas, then executes PFT, FST/full inversion, Boolean search, WXIS IsisScript, FDT validation, and raw MX arguments. Output is rendered as text, and the staged artifact is deployable through GitHub Pages. |
| FDT schema support | Verified host-side subset | `parseCisisFdt()` reads legacy fixed-column FDT files; `validateCisisRecordsAgainstFdt()` reports unknown tags, non-repeatable occurrences, UTF-8 byte-limit violations, and undeclared subfields. The playground uses the parsed schema for its field map and validates record edits before writing. |

## Language and workflow coverage

| Area | State | Verified coverage | Important gaps |
| --- | --- | --- | --- |
| PFT | Supported subset | literals, MFN, field/subfield selection, missing/repeated fields, uppercase mode, `nocc`, `size`, `left`, combining/non-Latin UTF-8, and one fatal syntax error | other modes, broader functions/includes, and more errors need focused cases |
| IsisScript flow | Supported subset | display, fields, loops, CGI parameters, and nested includes | broader flow/error examples and precise source diagnostics |
| IsisScript database work | Supported subset | ISO import/export, update writes, database reads, file deletion, Boolean search, and malformed-search reporting | record deletion, sort, XML conversion, and temporary-file workflows |
| Database format | Supported subset | ISO2709 import/export, current ISIS1660 MST/XRF creation/reads, active/deleted structured readback, sparse MFNs, complete-record upserts, and logical deletion | other historical layouts, large databases, and endian portability |
| FST and inversion | Supported subset | bundled CDS techniques 0, 2, and 4; full inversion through the in-process CISIS sorter | other techniques, stopword/table variants, and incremental inversion |
| Search | Supported subset | MX and WXIS Boolean retrieval, a compound `AND`, and one WXIS malformed-expression path | broader syntax-error matrix, prefixes, sets, logs, and larger result sets |
| UTF-8 | Supported subset | combining characters plus asserted Polish, Japanese, and Greek output | table-driven case conversion and deliberately invalid byte sequences |
| FDT | Supported host-side subset | fixed-column parsing, field names/tags, subfields, maximum byte length, repeatability, and structured-record validation | ABCD pipe-delimited FDT variants, data-entry worksheets, and legacy FDT-driven XML conversion |

## Differential scenarios

Twelve scenarios currently execute against both native 32-bit and Wasm builds:

1. UTF-8 sequence input and PFT output.
2. Polish, Japanese, and Greek PFT output.
3. WXIS hello/display output.
4. WXIS field definition and loop control.
5. WXIS nested includes and calls.
6. Fatal PFT syntax error with structured format diagnostics.
7. Structured active-record import and PFT formatting, including repeated fields,
   UTF-8, and subfields.
8. Structured multi-record creation with sparse MFNs and logical deletion.
9. WXIS file deletion and inspected post-run file state.
10. ISO import/export, database reads, and PFT missing/repeated fields,
   subfields, uppercase mode, and functions.
11. ISO import, FST full inversion, simple/compound MX search, WXIS search, and
   malformed search.
12. WXIS ISO import/update followed by an MX database read.

The differential runner compares exit status, stdout, stderr, and requested
output-file SHA-256 checksums. It normalizes CRLF to LF and removes one terminal
LF because Emscripten delivers output through line callbacks. The fatal parser
case additionally normalizes terminal stderr newlines because native stdio and
the callback transport preserve different counts. Generated ISO, MST/XRF, and
all six inverted-file companions match the native 32-bit build byte-for-byte in
covered scenarios. CI publishes the compatibility and performance JSON reports
with the Wasm artifact.

## Initial performance and artifact budgets

The CI harness publishes `performance-report.json` and enforces conservative
artifact ceilings. An Apple Silicon Node 24 run with Emscripten 6.0.4 measured
the 74,574-byte CDS ISO fixture as follows; timings are indicative, not browser
release budgets:

| Metric | Current measurement | Budget |
| --- | ---: | ---: |
| MX JavaScript | 86,782 bytes | 128 KiB |
| MX Wasm | 436,050 bytes | 512 KiB |
| WXIS JavaScript | 86,259 bytes | 128 KiB |
| WXIS Wasm | 499,759 bytes | 640 KiB |
| CDS import | 19.8 ms | Measurement only |
| Format 100 records | 6.4 ms median over 5 runs | Measurement only |
| Direct read of 100 records | 6.6 ms median over 5 runs | Measurement only |

The MX record ABI added 11,998 Wasm bytes and 1,483 JavaScript bytes versus the
previous local artifact, a 2.8% Wasm increase. Browser cold start, peak memory,
upload time, and large-database measurements remain before release budgets can
be set for latency and memory.

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
| Structured read limit | 1,000 active or logically deleted records per call; use `from` for paging. |
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
- Cover database sort, incremental inversion, and more deletion/reactivation
  transitions.
- Cover IsisScript XML, including the missing `record2xml.xic` dependency,
  temporary files, and unsupported-operation errors.
- Measure browser cold start, memory, upload time, and large-database behavior.
- Define IndexedDB quota budgets/recovery and multi-tab behavior.
- Add sanitizer builds, fuzz smoke tests, release provenance, checksums, SBOM,
  and LGPL source/relinking deliverables.
