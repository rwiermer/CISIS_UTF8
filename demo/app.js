import {
  CisisRunner,
  parseCisisFdt,
  validateCisisRecordsAgainstFdt,
} from "./runtime/index.js";

const DEMO_RECORDS = [
  {
    mfn: 1,
    status: "active",
    fields: [
      { tag: 24, value: "The climate archive" },
      { tag: 70, value: "Maya Okafor" },
      { tag: 70, value: "Lucía Santos" },
      { tag: 69, value: "Climate data" },
      { tag: 69, value: "Digital preservation" },
      { tag: 26, value: "^aAmsterdam^bOpen Archive Press" },
      { tag: 30, value: "2024" },
    ],
  },
  {
    mfn: 2,
    status: "active",
    fields: [
      { tag: 24, value: "日本語図書館のメタデータ" },
      { tag: 70, value: "Aiko Tanaka" },
      { tag: 69, value: "Libraries" },
      { tag: 69, value: "Metadata" },
      { tag: 26, value: "^aKyoto^bKnowledge Commons" },
      { tag: 30, value: "2022" },
    ],
  },
  {
    mfn: 3,
    status: "active",
    fields: [
      { tag: 24, value: "Community radio collections" },
      { tag: 70, value: "Kwame Mensah" },
      { tag: 69, value: "Oral history" },
      { tag: 69, value: "Radio archives" },
      { tag: 26, value: "^aAccra^bCommunity Media Lab" },
      { tag: 30, value: "2021" },
    ],
  },
  {
    mfn: 4,
    status: "active",
    fields: [
      { tag: 24, value: "Preserving multilingual research data" },
      { tag: 70, value: "Elena Petrova" },
      { tag: 70, value: "Noor Haddad" },
      { tag: 69, value: "Research data" },
      { tag: 69, value: "Digital preservation" },
      { tag: 26, value: "^aBeirut^bOpen Scholarship Press" },
      { tag: 30, value: "2023" },
    ],
  },
];

const DEMO_FDT = `W:DEMO
F:DEMO  F     DEMO1
S:DEMO
***
Title                         z                   24 500 0 0
Imprint                       ab                  26 300 0 0
Year                                              30 20 0 0
Subjects                                          69 1000 0 1
Authors                                           70 300 0 1
`;

const LOOP_SCRIPT = `<?xml version="1.0"?>
<!DOCTYPE IsisScript SYSTEM "wxis.dtd">
<IsisScript>
  <section>
    <field action="cgi" tag="2001">visitor</field>
    <display><pft>'WXIS running in WebAssembly'/#</pft></display>
    <display><pft>'Hello, ',v2001/#</pft></display>
    <do>
      <parm name="to">3</parm>
      <field action="define" tag="1001">Isis_Current</field>
      <field action="define" tag="1002">Isis_Total</field>
      <loop>
        <display><pft>'Iteration ',v1001,' of ',v1002/</pft></display>
      </loop>
    </do>
  </section>
</IsisScript>`;

const CATALOG_SCRIPT = `<?xml version="1.0"?>
<!DOCTYPE IsisScript SYSTEM "wxis.dtd">
<IsisScript>
  <section>
    <field action="cgi" tag="2003">count</field>
    <do task="mfnrange">
      <parm name="db">demo</parm>
      <parm name="from">1</parm>
      <parm name="count"><pft>v2003</pft></parm>
      <loop>
        <display><pft>mfn(3),' | ',v24/</pft></display>
      </loop>
    </do>
  </section>
</IsisScript>`;

const CHECK_FORMAT_SCRIPT = `<?xml version="1.0"?>
<!DOCTYPE IsisScript SYSTEM "wxis.dtd">
<IsisScript>
  <section>
    <field action="cgi" tag="2065">pft</field>
    <display><pft type="check"><pft>v2065</pft></pft></display>
  </section>
</IsisScript>`;

const deletedRecords = structuredClone(DEMO_RECORDS);
deletedRecords[3].status = "deleted";

const EXAMPLES = {
  pft: [
    {
      label: "Catalog overview",
      source: "mfn(3),'  ',v24/,'     ',(v70+|; |)/,'     ',(v69+| · |),'  [',v30,']'/",
    },
    {
      label: "Repeated authors",
      source: "mfn(3),' | ',v24/,(f(iocc,2,0),' | ',v70/)/",
    },
    {
      label: "Imprint subfields",
      source: "mfn(3),' | ',v24/,'     ',v26^a,' : ',v26^b,' (',v30,')'/",
    },
    {
      label: "Conditional fields",
      source: "mfn(3),' | ',v24/,if p(v70) then '     by ',(v70+|; |)/ else '     anonymous'/ fi",
    },
  ],
  search: [
    {
      label: "Title words",
      fst: "24 4 MHU,V24",
      expression: "CLIMATE",
      pft: "mfn(3),'  ',v24/",
    },
    {
      label: "Author words",
      fst: "70 4 (MHU,V70/)",
      expression: "TANAKA",
      pft: "mfn(3),'  ',v24,' — ',(v70+|; |)/",
    },
    {
      label: "Subject words",
      fst: "69 4 (MHU,V69/)",
      expression: "PRESERVATION",
      pft: "mfn(3),'  ',v24/,'     ',(v69+| · |)/",
    },
    {
      label: "Compound AND",
      fst: "24 4 MHU,V24\n69 4 (MHU,V69/)",
      expression: "DIGITAL * PRESERVATION",
      pft: "mfn(3),'  ',v24/",
    },
  ],
  wxis: [
    { label: "CGI parameter + loop", source: LOOP_SCRIPT, params: { visitor: "browser" } },
    { label: "Database range", source: CATALOG_SCRIPT, params: { count: 3 } },
    {
      label: "Dynamic PFT check",
      source: CHECK_FORMAT_SCRIPT,
      params: { pft: "if p(v24) then v24/ fi" },
    },
  ],
  records: [
    { label: "Active catalog", records: DEMO_RECORDS },
    { label: "Logical deletion", records: deletedRecords },
    {
      label: "Repeated + subfields",
      records: [
        {
          mfn: 1,
          status: "active",
          fields: [
            { tag: 24, value: "A field-rich record" },
            { tag: 70, value: "First Author" },
            { tag: 70, value: "Second Author" },
            { tag: 69, value: "Libraries" },
            { tag: 69, value: "Open data" },
            { tag: 26, value: "^aParis^bDocumentation Press" },
            { tag: 30, value: "2025" },
          ],
        },
      ],
    },
  ],
  fdt: [
    { label: "Demo catalog schema", source: DEMO_FDT },
    {
      label: "Strict byte limits",
      source: DEMO_FDT.replace("24 500", "24 12").replace("70 300", "70 8"),
    },
    {
      label: "Minimal title schema",
      source: `W:MINI
F:MINI  F     MINI1
S:MINI
***
Title                         z                   24 500 0 0
`,
    },
  ],
  mx: [
    {
      label: "List records",
      args: ["demo", "pft=mfn(3),'|',v24/", "count=3", "lw=0", "now"],
    },
    {
      label: "Select one MFN",
      args: ["demo", "pft=mfn(3),'|',v24/", "from=2", "count=1", "lw=0", "now"],
    },
    {
      label: "Sequence input",
      args: ["seq=notes.txt", "pft=mfn(3),'|',v1/", "lw=0", "now"],
    },
  ],
};

const operationNames = {
  pft: "PFT",
  search: "FST + Search",
  wxis: "WXIS",
  records: "Records",
  fdt: "FDT",
  mx: "MX",
};

const elements = {
  console: document.querySelector("#console"),
  copyButton: document.querySelector("#copy-button"),
  diagnosticList: document.querySelector("#diagnostic-list"),
  diagnostics: document.querySelector("#diagnostics"),
  duration: document.querySelector("#duration"),
  fdt: document.querySelector("#fdt-source"),
  fieldKey: document.querySelector("#field-key"),
  fst: document.querySelector("#fst-source"),
  mx: document.querySelector("#mx-source"),
  outputStatus: document.querySelector("#output-status"),
  pft: document.querySelector("#pft-source"),
  recordCount: document.querySelector("#record-count"),
  recordList: document.querySelector("#record-list"),
  records: document.querySelector("#records-source"),
  resetButton: document.querySelector("#reset-button"),
  runButton: document.querySelector("#run-button"),
  runLabel: document.querySelector("#run-label"),
  runtimeLabel: document.querySelector("#runtime-label"),
  runtimeState: document.querySelector("#runtime-state"),
  searchExpression: document.querySelector("#search-expression"),
  searchPft: document.querySelector("#search-pft"),
  wxis: document.querySelector("#wxis-source"),
  wxisParams: document.querySelector("#wxis-params"),
};

const exampleSelects = Object.fromEntries(
  Object.keys(EXAMPLES).map((name) => [name, document.querySelector(`#${name}-example`)]),
);

const runner = new CisisRunner({ defaultTimeoutMs: 12_000 });
let project;
let activeOperation = "pft";
let currentRecords = structuredClone(DEMO_RECORDS);
let currentFdt = parseCisisFdt(DEMO_FDT);

function fieldValues(record, tag) {
  return record.fields.filter((field) => field.tag === tag).map((field) => field.value);
}

function renderCatalog(records) {
  elements.recordCount.textContent = `${records.length} ${records.length === 1 ? "record" : "records"}`;
  elements.recordList.replaceChildren(...records.map((record) => {
    const item = document.createElement("li");
    item.className = "record-item";
    const meta = document.createElement("div");
    meta.className = "record-meta";
    const mfn = document.createElement("span");
    mfn.textContent = `MFN ${record.mfn}`;
    const status = document.createElement("span");
    status.className = record.status === "deleted" ? "status-deleted" : "";
    status.textContent = record.status;
    meta.append(mfn, status);
    const title = document.createElement("p");
    title.className = "record-title";
    title.textContent = fieldValues(record, 24)[0] ?? "Untitled";
    const author = document.createElement("p");
    author.className = "record-author";
    author.textContent = fieldValues(record, 70).join("; ") || "No author";
    item.append(meta, title, author);
    return item;
  }));
}

function renderFieldKey(definition) {
  elements.fieldKey.replaceChildren(...definition.fields.map((field) => {
    const item = document.createElement("span");
    const tag = document.createElement("b");
    tag.textContent = field.tag;
    item.append(tag, field.name.toLowerCase());
    return item;
  }));
}

function applyExample(group, index) {
  const example = EXAMPLES[group][index];
  if (!example) return;
  if (group === "pft") elements.pft.value = example.source;
  if (group === "search") {
    elements.fst.value = example.fst;
    elements.searchExpression.value = example.expression;
    elements.searchPft.value = example.pft;
  }
  if (group === "wxis") {
    elements.wxis.value = example.source;
    elements.wxisParams.value = JSON.stringify(example.params);
  }
  if (group === "records") elements.records.value = JSON.stringify(example.records, null, 2);
  if (group === "fdt") elements.fdt.value = example.source;
  if (group === "mx") elements.mx.value = example.args.join("\n");
}

function initializeExamples() {
  for (const [group, examples] of Object.entries(EXAMPLES)) {
    const select = exampleSelects[group];
    select.replaceChildren(...examples.map((example, index) => {
      const option = document.createElement("option");
      option.value = index;
      option.textContent = example.label;
      return option;
    }));
    select.addEventListener("change", () => applyExample(group, Number(select.value)));
  }
}

function resetEditors() {
  for (const [group, select] of Object.entries(exampleSelects)) {
    select.value = "0";
    applyExample(group, 0);
  }
}

function setOutput(text, state, durationMs = undefined, diagnostics = []) {
  elements.console.textContent = text || "(no output)";
  elements.outputStatus.textContent = state === "success" ? "Completed" : state === "error" ? "Failed" : state;
  elements.outputStatus.dataset.state = state;
  elements.duration.textContent = durationMs === undefined ? "" : `${Math.round(durationMs)} ms`;
  elements.diagnosticList.replaceChildren(...diagnostics.map((diagnostic) => {
    const item = document.createElement("li");
    item.textContent = `${diagnostic.category}: ${diagnostic.message}`;
    return item;
  }));
  elements.diagnostics.hidden = diagnostics.length === 0;
}

function setBusy(busy) {
  elements.runButton.disabled = busy;
  elements.resetButton.disabled = busy;
  if (busy) setOutput(`Running ${operationNames[activeOperation]}…`, "running");
}

async function createDemoProject(records = DEMO_RECORDS) {
  const nextProject = runner.createProject();
  const result = await nextProject.writeRecords({ database: "demo", records, replace: true });
  if (result.exitCode !== 0) throw new Error(result.stderr || "Could not create demo database");
  nextProject.writeFile("demo.fdt", elements.fdt.value || DEMO_FDT);
  nextProject.writeFile("notes.txt", "First sequence record\nSecond sequence record\n");
  return nextProject;
}

function normalizeRecords(value) {
  if (!Array.isArray(value)) throw new Error("Records JSON must be an array");
  return value.map((record) => ({
    mfn: record.mfn,
    status: record.status,
    fields: Array.isArray(record.fields)
      ? record.fields.map((field) => ({ tag: field.tag, value: field.value }))
      : [],
  }));
}

function resultText(result) {
  const streams = [result.stdout, result.stderr].filter(Boolean);
  return streams.join(result.stdout && result.stderr ? "\n\n--- stderr ---\n" : "");
}

async function runPft() {
  return project.format({ database: "demo", pft: elements.pft.value, count: 50 });
}

async function runSearch() {
  const indexed = await project.index({ database: "demo", fst: elements.fst.value });
  if (indexed.exitCode !== 0) return indexed;
  return project.search({
    database: "demo",
    expression: elements.searchExpression.value,
    pft: elements.searchPft.value,
    count: 50,
  });
}

async function runWxis() {
  const params = JSON.parse(elements.wxisParams.value || "{}");
  return project.runIsisScript({ source: elements.wxis.value, params });
}

async function runRecords() {
  const records = normalizeRecords(JSON.parse(elements.records.value));
  const validationIssues = validateCisisRecordsAgainstFdt(records, currentFdt);
  if (validationIssues.length > 0) {
    return {
      exitCode: 1,
      stdout: JSON.stringify({ valid: false, issues: validationIssues }, null, 2),
      stderr: "",
      diagnostics: validationIssues.map((issue) => ({
        category: "argument",
        message: issue.message,
        raw: issue.message,
        severity: "error",
      })),
      durationMs: 0,
    };
  }
  const result = await project.writeRecords({ database: "demo", records, replace: true });
  if (result.exitCode !== 0) return result;
  const readback = await project.readRecords({ database: "demo", count: 100 });
  if (readback.exitCode === 0) {
    currentRecords = readback.records;
    renderCatalog(currentRecords);
  }
  return { ...readback, stdout: JSON.stringify(readback.records, null, 2) };
}

async function runFdt() {
  const startedAt = performance.now();
  const definition = parseCisisFdt(elements.fdt.value);
  const issues = validateCisisRecordsAgainstFdt(currentRecords, definition);
  currentFdt = definition;
  project.writeFile("demo.fdt", elements.fdt.value);
  renderFieldKey(definition);
  return {
    exitCode: issues.length === 0 ? 0 : 1,
    stdout: JSON.stringify({
      valid: issues.length === 0,
      fields: definition.fields,
      issues,
    }, null, 2),
    stderr: "",
    diagnostics: issues.map((issue) => ({
      category: "argument",
      message: issue.message,
      raw: issue.message,
      severity: "error",
    })),
    durationMs: performance.now() - startedAt,
  };
}

async function runMx() {
  const args = elements.mx.value.split("\n").map((line) => line.trim()).filter(Boolean);
  return project.run({ program: "mx", args });
}

const operations = {
  pft: runPft,
  search: runSearch,
  wxis: runWxis,
  records: runRecords,
  fdt: runFdt,
  mx: runMx,
};

async function executeActiveOperation() {
  if (!project || elements.runButton.disabled) return;
  setBusy(true);
  try {
    const result = await operations[activeOperation]();
    const state = result.exitCode === 0 ? "success" : "error";
    setOutput(resultText(result), state, result.durationMs, result.diagnostics);
  } catch (error) {
    setOutput(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setBusy(false);
  }
}

function selectOperation(name) {
  activeOperation = name;
  for (const tab of document.querySelectorAll(".tab")) {
    const selected = tab.dataset.tab === name;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
  }
  for (const panel of document.querySelectorAll(".operation-panel")) {
    const selected = panel.id === `panel-${name}`;
    panel.classList.toggle("is-active", selected);
    panel.hidden = !selected;
  }
  elements.runLabel.textContent = name === "records"
    ? "Apply records"
    : name === "fdt"
      ? "Validate FDT"
      : `Run ${operationNames[name]}`;
}

async function resetDemo() {
  setBusy(true);
  try {
    resetEditors();
    currentRecords = structuredClone(DEMO_RECORDS);
    currentFdt = parseCisisFdt(DEMO_FDT);
    project = await createDemoProject(currentRecords);
    renderCatalog(currentRecords);
    renderFieldKey(currentFdt);
    setOutput("Demo catalog restored. Choose an operation and run it.", "success");
  } catch (error) {
    setOutput(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setBusy(false);
  }
}

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => selectOperation(tab.dataset.tab));
}
elements.runButton.addEventListener("click", executeActiveOperation);
elements.resetButton.addEventListener("click", resetDemo);
elements.copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(elements.console.textContent ?? "");
  elements.copyButton.textContent = "✓";
  setTimeout(() => { elements.copyButton.textContent = "⧉"; }, 1200);
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    executeActiveOperation();
  }
});

initializeExamples();
resetEditors();
renderCatalog(currentRecords);
renderFieldKey(currentFdt);
try {
  project = await createDemoProject(currentRecords);
  elements.runtimeState.classList.add("is-ready");
  elements.runtimeLabel.textContent = "Runtime ready";
  window.__cisisPlaygroundReady = true;
} catch (error) {
  elements.runtimeState.classList.add("is-error");
  elements.runtimeLabel.textContent = "Runtime failed";
  setOutput(error instanceof Error ? error.message : String(error), "error");
  window.__cisisPlaygroundError = error instanceof Error ? error.message : String(error);
}
