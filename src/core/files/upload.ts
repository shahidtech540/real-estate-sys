import { createHash } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import { AppError } from "@/core/errors";
import type { Capability } from "@/core/authz/policy";
import { processImage, type ImageKind } from "./images";

/**
 * Upload validation — `ARCHITECTURE.md` §7.1, §7.3 and `API.md` §3.12 COR-1.
 *
 * Size caps and magic-byte allowlists are per kind. Extensions and the client's
 * `Content-Type` are advisory only; the bytes decide (`ARCHITECTURE.md` §7.3
 * step 3). An unknown kind is a validation failure before anything is read.
 */

export type FileKind = ImageKind;

export interface FileRule {
  maxBytes: number;
  mimes: readonly string[];
  /** Write capability required to upload this kind (`API.md` COR-1 roles). */
  uploadCapability: Capability;
  /** Read capability required to download this kind (`API.md` COR-2 roles). */
  readCapability: Capability;
}

const MB = 1024 * 1024;

export const FILE_RULES: Record<FileKind, FileRule> = {
  MASTER_PLAN: {
    maxBytes: 25 * MB,
    mimes: ["image/jpeg", "image/png", "image/webp"],
    uploadCapability: "inventory.manage",
    readCapability: "inventory.read",
  },
  COMPANY_LOGO: {
    maxBytes: 2 * MB,
    mimes: ["image/jpeg", "image/png", "image/webp"],
    uploadCapability: "setup.manage",
    readCapability: "inventory.read",
  },
  BUYER_PHOTO: {
    maxBytes: 5 * MB,
    mimes: ["image/jpeg", "image/png"],
    uploadCapability: "buyer.edit",
    readCapability: "buyer.read",
  },
};

export function isFileKind(value: string): value is FileKind {
  return (
    value === "MASTER_PLAN" ||
    value === "BUYER_PHOTO" ||
    value === "COMPANY_LOGO"
  );
}

/** `jpg` for `image/jpeg`, `webp`, `png` — the extension half of the storage key. */
function extensionFor(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      throw new AppError("FILE_TYPE_UNSUPPORTED");
  }
}

export interface ValidatedUpload {
  kind: FileKind;
  bytes: Buffer;
  mimeType: string;
  extension: string;
  sha256: string;
  byteSize: number;
}

/**
 * Size → magic bytes → allowlist. Order matters for the status code a client
 * sees: an oversized file is `413` even if it is also the wrong type.
 */
export async function validateUpload(
  kind: FileKind,
  bytes: Buffer,
): Promise<ValidatedUpload> {
  const rule = FILE_RULES[kind];
  if (bytes.byteLength === 0) {
    throw new AppError("VALIDATION_FAILED", { fields: { file: "REQUIRED" } });
  }
  // `byte_size > 0` and the per-kind cap (DATABASE.md §3.11; ARCHITECTURE §7.1).
  if (bytes.byteLength > rule.maxBytes) {
    throw new AppError("FILE_TOO_LARGE");
  }

  const detected = await fileTypeFromBuffer(bytes);
  if (!detected || !rule.mimes.includes(detected.mime)) {
    throw new AppError("FILE_TYPE_UNSUPPORTED");
  }

  return {
    kind,
    bytes,
    mimeType: detected.mime,
    extension: extensionFor(detected.mime),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteSize: bytes.byteLength,
  };
}

export interface PreparedUpload extends ValidatedUpload {
  /** `<kind>/<xx>/<yy>/<sha256>.<ext>` — `ARCHITECTURE.md` §7.2, `ck_file_object_key`. */
  storageKey: string;
  widthPx: number | null;
  heightPx: number | null;
  blobs: Array<{ key: string; data: Buffer; contentType: string }>;
}

/**
 * Decode, normalize and build every blob to write. Nothing is persisted until
 * this resolves, so a decode failure leaves no `file_object` row
 * (`ARCHITECTURE.md` §7.3 step 7).
 */
export async function prepareUpload(
  upload: ValidatedUpload,
): Promise<PreparedUpload> {
  let processed;
  try {
    processed = await processImage(upload.kind, upload.bytes);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("FILE_UNREADABLE", { cause: error });
  }

  const { sha256, kind, extension } = upload;
  const base = `${kind}/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.${extension}`;
  const directory = base.slice(0, base.lastIndexOf("/") + 1);

  const blobs = [
    { key: base, data: upload.bytes, contentType: upload.mimeType },
    ...processed.derivatives.map((derivative) => ({
      key: `${directory}${sha256}${derivative.suffix}`,
      data: derivative.data,
      contentType: derivative.contentType,
    })),
  ];

  return {
    ...upload,
    storageKey: base,
    widthPx: processed.width > 0 ? processed.width : null,
    heightPx: processed.height > 0 ? processed.height : null,
    blobs,
  };
}

/** Key of a derivative of an existing object (`API.md` COR-2 `variant`). */
export function derivativeKey(storageKey: string, suffix: string): string {
  return `${storageKey.slice(0, storageKey.lastIndexOf("/") + 1)}${storageKey.slice(
    storageKey.lastIndexOf("/") + 1,
    storageKey.lastIndexOf("."),
  )}${suffix}`;
}
