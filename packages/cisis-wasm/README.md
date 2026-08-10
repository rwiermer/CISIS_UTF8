# CISIS WebAssembly runner

`@abcd-community/cisis-wasm` runs MX and WXIS in an isolated module Web Worker.
Each call receives a fresh in-memory filesystem. Keep project files in the host
application and merge returned files into that project before the next call.

```ts
import { CisisRunner } from "@abcd-community/cisis-wasm";

const runner = new CisisRunner();
const databaseFiles = {
  "cds.mst": uploadedMst,
  "cds.xrf": uploadedXrf,
};

const formatted = await runner.format({
  database: "cds",
  pft: "mfn(4),'|',v24/",
  files: databaseFiles,
  count: 10,
});

const indexed = await runner.index({
  database: "cds",
  fst: "70 0 MHU,(V70/)\n24 4 MHU,V24\n",
  files: databaseFiles,
});

const projectFiles = { ...databaseFiles, ...indexed.files };
const searched = await runner.search({
  database: "cds",
  expression: "plants",
  pft: "mfn(4),'|',v24/",
  files: projectFiles,
});

const scriptResult = await runner.runIsisScript({
  source: isisScriptSource,
  params: { db: "cds", count: 10 },
  files: projectFiles,
});

runner.dispose();
```

The low-level `run()` method remains available for MX or WXIS arguments not yet
represented by a helper. PFT, FST, search expressions, and IsisScript output are
untrusted user input from the host application's perspective. Render generated
HTML only after applying the application's sanitization policy.
