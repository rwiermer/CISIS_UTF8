import type { CisisRecord, CisisRecordField } from "./types.js";

const HEADER_BYTES = 24;
const DIRECTORY_ENTRY_BYTES = 12;
const FIELD_SEPARATOR = 0x23;
const MAX_RECORD_BYTES = 99_999;

function decimal(value: number, width: number, name: string): string {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 10 ** width) {
    throw new Error(`CISIS ${name} does not fit ${width} digits: ${value}`);
  }
  return String(value).padStart(width, "0");
}

function fieldBytes(field: CisisRecordField): Uint8Array {
  if (!Number.isSafeInteger(field.tag) || field.tag < 1 || field.tag > 999) {
    throw new Error(`CISIS record tag must be between 1 and 999: ${field.tag}`);
  }
  const data = typeof field.value === "string" ? new TextEncoder().encode(field.value) : field.value;
  if (!(data instanceof Uint8Array)) {
    throw new Error(`CISIS record field ${field.tag} is not text or a Uint8Array`);
  }
  if (data.includes(FIELD_SEPARATOR)) {
    throw new Error(`CISIS record field ${field.tag} contains reserved byte 0x23`);
  }
  if (data.byteLength + 1 > 9_999) {
    throw new Error(`CISIS record field ${field.tag} exceeds the ISO2709 field limit`);
  }
  return data;
}

export function encodeIso2709Record(record: CisisRecord): Uint8Array {
  if (record.status === "deleted") {
    throw new Error("Deleted CISIS records cannot be imported through ISO2709");
  }
  const fields = record.fields.map((field) => ({ field, data: fieldBytes(field) }));
  const baseAddress = HEADER_BYTES + fields.length * DIRECTORY_ENTRY_BYTES + 1;
  let dataBytes = 1;
  for (const { data } of fields) dataBytes += data.byteLength + 1;
  const recordLength = baseAddress + dataBytes;
  if (recordLength > MAX_RECORD_BYTES) {
    throw new Error(`CISIS ISO2709 record exceeds ${MAX_RECORD_BYTES} bytes`);
  }

  const output = new Uint8Array(recordLength);
  const encoder = new TextEncoder();
  const leader =
    `${decimal(recordLength, 5, "record length")}0000002` +
    `${decimal(baseAddress, 5, "base address")}3004500`;
  output.set(encoder.encode(leader));

  let directoryOffset = HEADER_BYTES;
  let fieldOffset = 0;
  for (const { field, data } of fields) {
    const entry =
      `${decimal(field.tag, 3, "field tag")}` +
      `${decimal(data.byteLength + 1, 4, "field length")}` +
      `${decimal(fieldOffset, 5, "field offset")}`;
    output.set(encoder.encode(entry), directoryOffset);
    directoryOffset += DIRECTORY_ENTRY_BYTES;
    fieldOffset += data.byteLength + 1;
  }

  output[directoryOffset] = FIELD_SEPARATOR;
  let dataOffset = baseAddress;
  for (const { data } of fields) {
    output.set(data, dataOffset);
    dataOffset += data.byteLength;
    output[dataOffset] = FIELD_SEPARATOR;
    dataOffset += 1;
  }
  output[dataOffset] = FIELD_SEPARATOR;
  return output;
}
