# CISIS WebAssembly runner

`@abcd-community/cisis-wasm` runs MX and WXIS in an isolated module Web Worker.
Each call receives a fresh in-memory filesystem. `CisisProject` retains files in
the JavaScript host and supplies them to each call; only files explicitly
requested from a run are added back to the project.

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

The low-level `run()` method remains available for MX or WXIS arguments not yet
represented by a helper. Pass `returnFiles` when a low-level operation creates
or changes files that the project must retain. Pass `inspectFiles` for paths
whose existence must be synchronized after a run; `CisisProject` removes a
retained file when the result reports that it no longer exists. IndexedDB
storage is optional; snapshots are plain versioned objects and can also be
exported by the host. Project archives are deterministic binary `Uint8Array`
values suitable for download or upload without base64 conversion.

PFT, FST, search expressions, and IsisScript output are untrusted user input
from the host application's perspective. Render generated HTML only after
applying the application's sanitization policy.
