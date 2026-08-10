import { CisisRunner } from "./runtime/index.js";

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
      { tag: 30, value: "2023" },
    ],
  },
];

const DEFAULTS = {
  pft: "mfn(3),'  ',v24/,'     ',(v70+|; |)/,'     ',(v69+| · |),'  [',v30,']'/",
  fst: "24 4 MHU,V24\n70 4 (MHU,V70/)\n69 4 (MHU,V69/)",
  expression: "CLIMATE",
  searchPft: "mfn(3),'  ',v24/",
  wxis: `<?xml version="1.0"?>
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
</IsisScript>`,
  wxisParams: '{"visitor":"browser"}',
  mx: "demo\npft=mfn(3),'|',v24/\ncount=3\nlw=0\nnow",
};

const operationNames = {
  pft: "PFT",
  search: "FST + Search",
  wxis: "WXIS",
  records: "Records",
  mx: "MX",
};

const elements = {
  console: document.querySelector("#console"),
  copyButton: document.querySelector("#copy-button"),
  diagnosticList: document.querySelector("#diagnostic-list"),
  diagnostics: document.querySelector("#diagnostics"),
  duration: document.querySelector("#duration"),
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

const runner = new CisisRunner({ defaultTimeoutMs: 12_000 });
let project;
let activeOperation = "pft";
let currentRecords = structuredClone(DEMO_RECORDS);

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

function resetEditors() {
  elements.pft.value = DEFAULTS.pft;
  elements.fst.value = DEFAULTS.fst;
  elements.searchExpression.value = DEFAULTS.expression;
  elements.searchPft.value = DEFAULTS.searchPft;
  elements.wxis.value = DEFAULTS.wxis;
  elements.wxisParams.value = DEFAULTS.wxisParams;
  elements.records.value = JSON.stringify(DEMO_RECORDS, null, 2);
  elements.mx.value = DEFAULTS.mx;
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
  const result = await project.writeRecords({ database: "demo", records, replace: true });
  if (result.exitCode !== 0) return result;
  const readback = await project.readRecords({ database: "demo", count: 100 });
  if (readback.exitCode === 0) {
    currentRecords = readback.records;
    renderCatalog(currentRecords);
  }
  return { ...readback, stdout: JSON.stringify(readback.records, null, 2) };
}

async function runMx() {
  const args = elements.mx.value.split("\n").map((line) => line.trim()).filter(Boolean);
  return project.run({ program: "mx", args });
}

const operations = { pft: runPft, search: runSearch, wxis: runWxis, records: runRecords, mx: runMx };

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
  elements.runLabel.textContent = name === "records" ? "Apply records" : `Run ${operationNames[name]}`;
}

async function resetDemo() {
  setBusy(true);
  try {
    resetEditors();
    currentRecords = structuredClone(DEMO_RECORDS);
    project = await createDemoProject(currentRecords);
    renderCatalog(currentRecords);
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

resetEditors();
renderCatalog(currentRecords);
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
