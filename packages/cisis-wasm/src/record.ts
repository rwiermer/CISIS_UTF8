import type { CisisRecord, CisisRecordData, CisisRecordField } from "./types.js";

const HEADER_BYTES = 24;
const DIRECTORY_ENTRY_BYTES = 12;
const FIELD_SEPARATOR = 0x23;
const MAX_RECORD_BYTES = 99_999;
const ISO_FIELD_SEPARATOR = 0x1e;
const ISO_RECORD_SEPARATOR = 0x1d;

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

export function encodeIso2709Record(record: CisisRecordData): Uint8Array {
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

function decimalBytes(data: Uint8Array, start: number, width: number, name: string): number {
  let value = 0;
  for (let index = start; index < start + width; index += 1) {
    const byte = data[index];
    if (byte === undefined || byte < 0x30 || byte > 0x39) {
      throw new Error(`Invalid ISO2709 ${name}`);
    }
    value = value * 10 + byte - 0x30;
  }
  return value;
}

export function decodeIso2709Records(input: ArrayBuffer | Uint8Array): CisisRecordData[] {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const records: CisisRecordData[] = [];
  let recordOffset = 0;

  while (recordOffset < data.byteLength) {
    if (data.byteLength - recordOffset < HEADER_BYTES + 1) {
      throw new Error("Truncated ISO2709 record header");
    }
    const recordLength = decimalBytes(data, recordOffset, 5, "record length");
    const baseAddress = decimalBytes(data, recordOffset + 12, 5, "base address");
    const recordEnd = recordOffset + recordLength;
    if (
      recordLength < HEADER_BYTES + 1 ||
      recordEnd > data.byteLength ||
      baseAddress < HEADER_BYTES + 1 ||
      baseAddress >= recordLength
    ) {
      throw new Error("Invalid ISO2709 record bounds");
    }
    if (data[recordEnd - 1] !== ISO_RECORD_SEPARATOR) {
      throw new Error("ISO2709 record terminator is missing");
    }

    const directoryBytes = baseAddress - HEADER_BYTES - 1;
    if (directoryBytes % DIRECTORY_ENTRY_BYTES !== 0) {
      throw new Error("Invalid ISO2709 directory length");
    }
    const directoryEnd = recordOffset + HEADER_BYTES + directoryBytes;
    if (data[directoryEnd] !== ISO_FIELD_SEPARATOR) {
      throw new Error("ISO2709 directory terminator is missing");
    }

    const fields: CisisRecordField[] = [];
    for (
      let directoryOffset = recordOffset + HEADER_BYTES;
      directoryOffset < directoryEnd;
      directoryOffset += DIRECTORY_ENTRY_BYTES
    ) {
      const tag = decimalBytes(data, directoryOffset, 3, "field tag");
      const fieldLength = decimalBytes(data, directoryOffset + 3, 4, "field length");
      const fieldOffset = decimalBytes(data, directoryOffset + 7, 5, "field offset");
      const fieldStart = recordOffset + baseAddress + fieldOffset;
      const fieldEnd = fieldStart + fieldLength;
      if (fieldLength < 1 || fieldStart < recordOffset + baseAddress || fieldEnd >= recordEnd) {
        throw new Error(`Invalid ISO2709 field bounds for tag ${tag}`);
      }
      if (data[fieldEnd - 1] !== ISO_FIELD_SEPARATOR) {
        throw new Error(`ISO2709 field terminator is missing for tag ${tag}`);
      }
      fields.push({ tag, value: data.slice(fieldStart, fieldEnd - 1) });
    }
    records.push({ fields });
    recordOffset = recordEnd;
  }

  return records;
}

export function decodeCisisRecordExport(input: ArrayBuffer | Uint8Array): CisisRecord[] {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  let offset = 0;
  const requireBytes = (length: number): void => {
    if (length < 0 || offset + length > data.byteLength) {
      throw new Error("Truncated CISIS record export");
    }
  };
  const readU8 = (): number => {
    requireBytes(1);
    return data[offset++]!;
  };
  const readU16 = (): number => readU8() | (readU8() << 8);
  const readU32 = (): number => (
    readU8() |
    (readU8() << 8) |
    (readU8() << 16) |
    (readU8() << 24)
  ) >>> 0;

  requireBytes(8);
  if (String.fromCharCode(...data.subarray(0, 4)) !== "CWR1") {
    throw new Error("Invalid CISIS record export header");
  }
  offset = 4;
  const recordCount = readU32();
  const records: CisisRecord[] = [];
  for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
    const mfn = readU32();
    const status = readU8();
    const fieldCount = readU32();
    if (mfn < 1) throw new Error("Invalid MFN in CISIS record export");
    if (status !== 0 && status !== 1) {
      throw new Error(`Invalid status in CISIS record export at MFN ${mfn}`);
    }
    const fields: CisisRecordField[] = [];
    for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex += 1) {
      const tag = readU16();
      const length = readU32();
      requireBytes(length);
      fields.push({ tag, value: data.slice(offset, offset + length) });
      offset += length;
    }
    records.push({ mfn, status: status === 0 ? "active" : "deleted", fields });
  }
  if (offset !== data.byteLength) throw new Error("Trailing data in CISIS record export");
  return records;
}
