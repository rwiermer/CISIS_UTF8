import type { CisisInputFile, CisisRecord } from "./types.js";

export interface CisisFdtField {
  name: string;
  subfields: readonly string[];
  tag: number;
  maxBytes: number;
  type: number;
  repeatable: boolean;
}

export interface CisisFdtDefinition {
  headers: readonly string[];
  fields: readonly CisisFdtField[];
}

export type CisisFdtValidationCode =
  | "unknown-field"
  | "non-repeatable-field"
  | "field-too-long"
  | "invalid-subfield";

export interface CisisFdtValidationIssue {
  code: CisisFdtValidationCode;
  message: string;
  mfn: number;
  tag: number;
  occurrence?: number;
}

export class CisisFdtParseError extends Error {
  readonly line: number;

  constructor(line: number, message: string) {
    super(`Invalid CISIS FDT at line ${line}: ${message}`);
    this.name = "CisisFdtParseError";
    this.line = line;
  }
}

const FIELD_ROW = /^(.*?)\s{2,}([A-Za-z0-9]*)\s+(\d+)\s+(\d+)\s+(\d+)\s+([01])\s*$/;

export function parseCisisFdt(source: string): CisisFdtDefinition {
  if (typeof source !== "string") throw new TypeError("CISIS FDT source must be a string");
  const lines = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const separator = lines.findIndex((line) => line.trim() === "***");
  if (separator < 0) throw new CisisFdtParseError(1, "missing *** header separator");

  const headers = lines.slice(0, separator).map((line) => line.trimEnd()).filter(Boolean);
  const fields: CisisFdtField[] = [];
  const tags = new Set<number>();
  for (let index = separator + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) continue;
    const match = FIELD_ROW.exec(line);
    if (!match) {
      throw new CisisFdtParseError(index + 1, "expected name, subfields, tag, length, type, and repeatability");
    }

    const [, name = "", subfields = "", tagText = "", maxBytesText = "", typeText = "", repeatableText = ""] = match;
    const tag = Number(tagText);
    if (tag < 1 || tag > 999) {
      throw new CisisFdtParseError(index + 1, `field tag must be between 1 and 999: ${tagText}`);
    }
    if (tags.has(tag)) throw new CisisFdtParseError(index + 1, `duplicate field tag: ${tag}`);
    tags.add(tag);
    fields.push({
      name: name.trim(),
      subfields: [...subfields.toLowerCase()],
      tag,
      maxBytes: Number(maxBytesText),
      type: Number(typeText),
      repeatable: repeatableText === "1",
    });
  }
  if (fields.length === 0) throw new CisisFdtParseError(separator + 2, "no field definitions");
  return { headers, fields };
}

function byteLength(value: CisisInputFile): number {
  return typeof value === "string" ? new TextEncoder().encode(value).byteLength : value.byteLength;
}

function validateSubfields(
  value: CisisInputFile,
  field: CisisFdtField,
  record: CisisRecord,
  occurrence: number,
): CisisFdtValidationIssue[] {
  if (typeof value !== "string" || !value.includes("^")) return [];
  const allowed = new Set(field.subfields);
  const issues: CisisFdtValidationIssue[] = [];
  const markers = value.matchAll(/\^(.)/gu);
  let markerCount = 0;
  for (const marker of markers) {
    markerCount += 1;
    const code = marker[1]!.toLowerCase();
    if (allowed.has(code)) continue;
    issues.push({
      code: "invalid-subfield",
      message: `MFN ${record.mfn} field ${field.tag} occurrence ${occurrence} uses undeclared subfield ^${code}`,
      mfn: record.mfn,
      tag: field.tag,
      occurrence,
    });
  }
  if (markerCount === 0 || value.endsWith("^")) {
    issues.push({
      code: "invalid-subfield",
      message: `MFN ${record.mfn} field ${field.tag} occurrence ${occurrence} has an incomplete subfield marker`,
      mfn: record.mfn,
      tag: field.tag,
      occurrence,
    });
  }
  return issues;
}

export function validateCisisRecordsAgainstFdt(
  records: readonly CisisRecord[],
  definition: CisisFdtDefinition,
): CisisFdtValidationIssue[] {
  const definitions = new Map(definition.fields.map((field) => [field.tag, field]));
  const issues: CisisFdtValidationIssue[] = [];
  for (const record of records) {
    const occurrences = new Map<number, number>();
    for (const recordField of record.fields) {
      const occurrence = (occurrences.get(recordField.tag) ?? 0) + 1;
      occurrences.set(recordField.tag, occurrence);
      const field = definitions.get(recordField.tag);
      if (!field) {
        issues.push({
          code: "unknown-field",
          message: `MFN ${record.mfn} uses field ${recordField.tag}, which is not defined in the FDT`,
          mfn: record.mfn,
          tag: recordField.tag,
          occurrence,
        });
        continue;
      }
      if (!field.repeatable && occurrence > 1) {
        issues.push({
          code: "non-repeatable-field",
          message: `MFN ${record.mfn} repeats non-repeatable field ${field.tag} (${field.name})`,
          mfn: record.mfn,
          tag: field.tag,
          occurrence,
        });
      }
      const length = byteLength(recordField.value);
      if (field.maxBytes > 0 && length > field.maxBytes) {
        issues.push({
          code: "field-too-long",
          message: `MFN ${record.mfn} field ${field.tag} occurrence ${occurrence} is ${length} bytes; FDT limit is ${field.maxBytes}`,
          mfn: record.mfn,
          tag: field.tag,
          occurrence,
        });
      }
      issues.push(...validateSubfields(recordField.value, field, record, occurrence));
    }
  }
  return issues;
}
