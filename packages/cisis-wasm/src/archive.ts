import { normalizeVirtualPath } from "./path.js";
import type { CisisProjectSnapshot } from "./project.js";

const MAGIC = new TextEncoder().encode("CISISPRJ");
const HEADER_BYTES = 16;
const ENTRY_HEADER_BYTES = 8;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_FILES = 10_000;
const MAX_PATH_BYTES = 4_096;

function checkedSize(value: number, limit: number, message: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > limit) throw new Error(message);
}

export function encodeProjectArchive(snapshot: CisisProjectSnapshot): Uint8Array {
  if (snapshot.schemaVersion !== 1) {
    throw new Error(`Unsupported CISIS project schema: ${String(snapshot.schemaVersion)}`);
  }

  const encoder = new TextEncoder();
  const entries = Object.entries(snapshot.files)
    .map(([path, data]) => {
      const normalized = normalizeVirtualPath(path);
      if (!(data instanceof Uint8Array)) {
        throw new Error(`CISIS project file is not a Uint8Array: ${path}`);
      }
      const pathBytes = encoder.encode(normalized);
      checkedSize(pathBytes.byteLength, MAX_PATH_BYTES, `CISIS project path is too long: ${path}`);
      checkedSize(data.byteLength, 0xffff_ffff, `CISIS project file is too large: ${path}`);
      return { path: normalized, pathBytes, data };
    })
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  checkedSize(entries.length, MAX_FILES, `CISIS project has more than ${MAX_FILES} files`);
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1]!.path === entries[index]!.path) {
      throw new Error(`Duplicate normalized CISIS project path: ${entries[index]!.path}`);
    }
  }

  let total = HEADER_BYTES;
  for (const entry of entries) {
    total += ENTRY_HEADER_BYTES + entry.pathBytes.byteLength + entry.data.byteLength;
    checkedSize(total, MAX_ARCHIVE_BYTES, `CISIS project archive exceeds ${MAX_ARCHIVE_BYTES} bytes`);
  }

  const archive = new Uint8Array(total);
  archive.set(MAGIC);
  const view = new DataView(archive.buffer);
  view.setUint32(8, 1, true);
  view.setUint32(12, entries.length, true);
  let offset = HEADER_BYTES;
  for (const entry of entries) {
    view.setUint32(offset, entry.pathBytes.byteLength, true);
    view.setUint32(offset + 4, entry.data.byteLength, true);
    offset += ENTRY_HEADER_BYTES;
    archive.set(entry.pathBytes, offset);
    offset += entry.pathBytes.byteLength;
    archive.set(entry.data, offset);
    offset += entry.data.byteLength;
  }
  return archive;
}

export function decodeProjectArchive(input: ArrayBuffer | Uint8Array): CisisProjectSnapshot {
  const archive = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error(`CISIS project archive exceeds ${MAX_ARCHIVE_BYTES} bytes`);
  }
  if (archive.byteLength < HEADER_BYTES || !MAGIC.every((byte, index) => archive[index] === byte)) {
    throw new Error("Invalid CISIS project archive header");
  }

  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const version = view.getUint32(8, true);
  if (version !== 1) throw new Error(`Unsupported CISIS project archive version: ${version}`);
  const count = view.getUint32(12, true);
  checkedSize(count, MAX_FILES, `CISIS project archive has more than ${MAX_FILES} files`);

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const files: Record<string, Uint8Array> = {};
  let offset = HEADER_BYTES;
  for (let index = 0; index < count; index += 1) {
    if (offset + ENTRY_HEADER_BYTES > archive.byteLength) {
      throw new Error("Truncated CISIS project archive entry");
    }
    const pathLength = view.getUint32(offset, true);
    const dataLength = view.getUint32(offset + 4, true);
    checkedSize(pathLength, MAX_PATH_BYTES, "CISIS project archive path is too long");
    offset += ENTRY_HEADER_BYTES;
    const end = offset + pathLength + dataLength;
    if (!Number.isSafeInteger(end) || end > archive.byteLength) {
      throw new Error("Truncated CISIS project archive data");
    }
    let path: string;
    try {
      path = normalizeVirtualPath(decoder.decode(archive.subarray(offset, offset + pathLength)));
    } catch (error) {
      throw new Error(`Invalid CISIS project archive path: ${String(error)}`);
    }
    if (Object.hasOwn(files, path)) throw new Error(`Duplicate CISIS project archive path: ${path}`);
    offset += pathLength;
    files[path] = archive.slice(offset, offset + dataLength);
    offset += dataLength;
  }
  if (offset !== archive.byteLength) throw new Error("Unexpected data after CISIS project archive");
  return { schemaVersion: 1, files };
}
