# CISIS WebAssembly runner

`@abcd-community/cisis-wasm` runs MX and WXIS in an isolated module Web Worker.
Each call receives a fresh in-memory filesystem. `CisisProject` retains files in
the JavaScript host and supplies them to each call; only files explicitly
requested from a run are added back to the project.

Live playground: <https://rwiermer.github.io/CISIS_UTF8/>

The repository also contains a dependency-free browser playground in `demo/`.
It exercises structured records, PFT formatting, FST inversion and search,
WXIS IsisScript, and low-level MX arguments through this public API. After the
package distribution contains the generated Wasm modules, stage the exact
GitHub Pages artifact with:

```sh
node scripts/build-pages.mjs
```

Serve the repository root and open `build/pages/index.html`; Wasm modules must
be served as `application/wasm`. The Pages workflow performs the pinned
Emscripten build and deploys the same staged artifact.

```ts
import {
  CisisProject,
  CisisProjectStore,
  CisisRunner,
} from "@abcd-community/cisis-wasm";

const runner = new CisisRunner();
const project = runner.createProject({
  "cds.mst": uploadedMst,
  "cds.xrf": uploadedXrf,
});

const formatted = await project.format({
  database: "cds",
  pft: "mfn(4),'|',v24/",
  count: 10,
});

const recordFormatted = await runner.formatRecord({
  record: {
    fields: [
      { tag: 24, value: "A title" },
      { tag: 70, value: "First author" },
      { tag: 70, value: "Second author" },
    ],
  },
  pft: "v24/, (v70/)",
});

await project.writeRecords({
  database: "cds",
  expectedRevision: project.revision,
  records: [
    {
      mfn: 12,
      status: "active",
      fields: [
        { tag: 24, value: "A replacement title" },
        { tag: 70, value: "First author" },
      ],
    },
    { mfn: 15, status: "deleted", fields: [] },
  ],
});

const activeRecords = await project.readRecords({
  database: "cds",
  from: 1,
  count: 100,
});

await project.index({
  database: "cds",
  fst: "70 0 MHU,(V70/)\n24 4 MHU,V24\n",
});

const searched = await project.search({
  database: "cds",
  expression: "plants",
  pft: "mfn(4),'|',v24/",
});

const scriptResult = await project.runIsisScript({
  source: isisScriptSource,
  params: { db: "cds", count: 10 },
});

const store = new CisisProjectStore();
await store.save("demo", project.snapshot());
const saved = await store.load("demo");
const restored = runner.createProject(saved?.files);

const archive = project.exportArchive();
const imported = CisisProject.fromArchive(runner, archive);
store.close();
runner.dispose();
```

Structured records preserve field order, repeated tags, UTF-8 values, and PFT
subfield syntax. `formatRecord()` imports exactly one active record as MFN 1;
it does not preserve caller-supplied MFNs or deleted status. `writeRecords()`
provides that database boundary for batches of up to 1,000 records and MFNs up
to 1,000,000. Writes preserve explicit MFNs and logical deletion status, replace
complete records, and invalidate retained inverted-file companions so the IDE
cannot search a stale index. `readRecords()` returns active and logically deleted
records with exact byte-valued fields and preserves their order and repetitions.
Reads default to at most 1,000 records and can be paged with `from` and `count`.
Project mutations are serialized and update the session-local `project.revision`.
Supplying `expectedRevision` to `writeRecords()` rejects stale IDE edits with
`CisisProjectConflictError`.

The low-level `run()` method remains available for MX or WXIS arguments not yet
represented by a helper. Pass `returnFiles` when a low-level operation creates
or changes files that the project must retain. Pass `inspectFiles` for paths
whose existence must be synchronized after a run; `CisisProject` removes a
retained file when the result reports that it no longer exists. IndexedDB
storage is optional; snapshots are plain versioned objects and can also be
exported by the host. Project archives are deterministic binary `Uint8Array`
values suitable for download or upload without base64 conversion. IndexedDB
schema upgrades are automatic. Storage failures expose `CisisProjectStoreError`
with a `blocked`, `corrupt`, or `quota` code for IDE error handling.

PFT, FST, search expressions, and IsisScript output are untrusted user input
from the host application's perspective. Render generated HTML only after
applying the application's sanitization policy.
