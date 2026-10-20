import { AppError } from "@/core/errors";
import { db, type Db } from "@/core/db";
import { requireCapability } from "@/core/authz/policy";
import type { FileKind } from "@/core/files/upload";
import {
  derivativeKey,
  FILE_RULES,
  prepareUpload,
  validateUpload,
} from "@/core/files/upload";
import { derivativeForVariant } from "@/core/files/images";
import { fileStore } from "@/core/files/store";
import type { Actor, RequestMeta } from "@/modules/identity";

/**
 * COR-1 / COR-2 — `API.md` §3.12, `ARCHITECTURE.md` §7.
 *
 * Uploads are two-step by design: this command stores a `file_object` and
 * nothing else. Binding the object to a project, company or buyer is the owning
 * module's command (SET-2, SET-7, SAL-2/SAL-4), which is why an unbound object
 * is an orphan until the grace period cleans it (`ARCHITECTURE.md` §7.5).
 */

export interface FileObjectDto {
  id: string;
  kind: FileKind;
  url: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  widthPx: number | null;
  heightPx: number | null;
  createdAt: string;
}

interface FileRow {
  id: string;
  kind: FileKind;
  storageKey: string;
  mimeType: string;
  byteSize: bigint;
  sha256: string;
  widthPx: number | null;
  heightPx: number | null;
  createdAt: Date;
  deletedAt: Date | null;
}

function toDto(row: FileRow): FileObjectDto {
  return {
    id: row.id,
    kind: row.kind,
    url: `/api/files/${row.id}`,
    mimeType: row.mimeType,
    byteSize: Number(row.byteSize),
    sha256: row.sha256,
    widthPx: row.widthPx,
    heightPx: row.heightPx,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Filenames are display-only and never used to build a path (`DATABASE.md` §3.11). */
function displayFilename(name: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control chars is the point
  const trimmed = name.replace(/[\u0000-\u001f]/g, "").trim();
  return (trimmed || "upload").slice(0, 255);
}

export interface UploadResult {
  file: FileObjectDto;
  created: boolean;
}

export async function uploadFile(
  actor: Actor,
  kind: FileKind,
  bytes: Buffer,
  originalFilename: string,
  meta: RequestMeta,
): Promise<UploadResult> {
  // Capability depends on the kind (`API.md` COR-1).
  requireCapability(actor, FILE_RULES[kind].uploadCapability);

  const validated = await validateUpload(kind, bytes);
  const prepared = await prepareUpload(validated);
  const client = db();

  // Content addressing dedupes identical bytes for this kind (`uq_file_object_storage_key`).
  const existing = (await client.fileObject.findUnique({
    where: { storageKey: prepared.storageKey },
  })) as FileRow | null;

  if (existing) {
    if (existing.deletedAt) {
      // Restored rather than duplicated; the unique key would reject a second row
      // (`API.md` COR-1).
      const restored = (await client.fileObject.update({
        where: { id: existing.id },
        data: { deletedAt: null },
      })) as FileRow;
      return { file: toDto(restored), created: false };
    }
    return { file: toDto(existing), created: false };
  }

  const store = fileStore();
  // Bytes first, row second: a crash between them leaves an orphan the weekly GC
  // removes, never a row without bytes (`ARCHITECTURE.md` §7.3 step 7, §7.6).
  for (const blob of prepared.blobs) {
    await store.put(blob.key, blob.data, {
      contentType: blob.contentType,
      byteSize: blob.data.byteLength,
    });
  }

  // COR-1's DB line names `file_object` only — no audit row. Binding the object
  // to a project/company/buyer is the audited step (`API.md` COR-1 notes).
  void meta;
  const created = (await client.fileObject.create({
    data: {
      kind: prepared.kind,
      storageKey: prepared.storageKey,
      originalFilename: displayFilename(originalFilename),
      mimeType: prepared.mimeType,
      byteSize: BigInt(prepared.byteSize),
      sha256: prepared.sha256,
      widthPx: prepared.widthPx,
      heightPx: prepared.heightPx,
      uploadedBy: actor.id,
    },
  })) as FileRow;

  return { file: toDto(created), created: true };
}

export interface ServedFile {
  stream: import("node:stream").Readable;
  contentType: string;
  etag: string;
  byteSize: number | null;
}

// ---------------------------------------------------------------------------
// Binding and lifecycle — used by the owning module's commands (SET-2, SET-7,
// SAL-2/SAL-4). They take the caller's client/transaction, because the binding
// write belongs to the caller's transaction (`ARCHITECTURE.md` §4.4 rule 3).
// ---------------------------------------------------------------------------

export interface BindableFile {
  id: string;
  kind: FileKind;
  deletedAt: Date | null;
}

/** Reads only the columns a binding check needs — never the storage key. */
export async function findFileForBinding(
  client: Db,
  id: string,
): Promise<BindableFile | null> {
  return (await client.fileObject.findUnique({
    where: { id },
    select: { id: true, kind: true, deletedAt: true },
  })) as BindableFile | null;
}

/**
 * "Is this object still referenced?" across the three reference columns —
 * `DATABASE.md` §3.11 (`file_object` dedupe + soft delete) and
 * `ARCHITECTURE.md` §7.5. The check lives with the file owner (`core`) because
 * it is a file-lifecycle rule, not a Setup rule; it is a union of counts, not a
 * cross-domain join.
 */
export async function countFileReferences(
  client: Db,
  fileId: string,
): Promise<number> {
  const [companies, projects, buyers] = await Promise.all([
    client.company.count({ where: { logoFileId: fileId } }),
    client.project.count({ where: { masterPlanFileId: fileId } }),
    client.buyer.count({ where: { photoFileId: fileId } }),
  ]);
  return companies + projects + buyers;
}

/** Soft delete inside the caller's transaction — the blob is removed later by the GC job. */
export async function softDeleteFile(
  client: Db,
  id: string,
  at: Date,
): Promise<void> {
  await client.fileObject.update({ where: { id }, data: { deletedAt: at } });
}

/**
 * Resolves an opaque id to a stored blob **after** the kind's read capability
 * check (`ARCHITECTURE.md` §7.4). The storage key never leaves this function.
 */
export async function openFile(
  actor: Actor,
  id: string,
  variant: "original" | "display" | "thumb" | "avatar",
): Promise<ServedFile> {
  const client = db();
  const row = (await client.fileObject.findUnique({
    where: { id },
  })) as FileRow | null;
  if (!row || row.deletedAt) throw new AppError("FILE_NOT_FOUND");

  // 403 before any existence leak for other callers; the row is already loaded
  // here because the capability depends on the row's kind.
  requireCapability(actor, FILE_RULES[row.kind].readCapability);

  const derivative = derivativeForVariant(row.kind, variant);
  const key = derivative
    ? derivativeKey(row.storageKey, derivative.suffix)
    : row.storageKey;
  const store = fileStore();
  if (!(await store.exists(key))) throw new AppError("FILE_NOT_FOUND");

  return {
    stream: await store.get(key),
    contentType: derivative ? derivative.contentType : row.mimeType,
    etag: row.sha256,
    byteSize: derivative ? null : Number(row.byteSize),
  };
}
