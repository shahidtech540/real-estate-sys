import sharp, { type Sharp } from "sharp";

/**
 * The image pipeline of `ARCHITECTURE.md` §7.3 steps 4–6.
 *
 * • `limitInputPixels` 100 MP stops decompression bombs (§7.3 step 4).
 * • sharp strips EXIF/GPS/ICC by re-encoding, which neutralizes embedded
 *   active content (§7.3 step 4).
 * • Derivatives are written under distinct keys; the original bytes are kept
 *   for `MASTER_PLAN` and `BUYER_PHOTO` (§7.1).
 *
 * Phase 1 implements the three kinds COR-1 accepts. Nothing here decides
 * authorization; the upload command does.
 */
export const MAX_INPUT_PIXELS = 100_000_000;

export type ImageKind = "MASTER_PLAN" | "BUYER_PHOTO" | "COMPANY_LOGO";

export interface Derivative {
  /** Suffix appended to the content-addressed key, e.g. `-thumb.webp`. */
  suffix: string;
  data: Buffer;
  contentType: string;
}

export interface ProcessedImage {
  /** Normalized image metadata (the value stored in width_px/height_px). */
  width: number;
  height: number;
  /** The normalization derivative that `variant=display` serves. */
  display: Derivative;
  derivatives: Derivative[];
}

function pipeline(input: Buffer): Sharp {
  return sharp(input, {
    limitInputPixels: MAX_INPUT_PIXELS,
    failOn: "error",
    // Rotate by EXIF, then drop the metadata entirely.
    autoOrient: true,
  });
}

async function toBuffer(
  image: Sharp,
  format: "jpeg" | "png" | "webp",
): Promise<Buffer> {
  if (format === "jpeg")
    return image.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  if (format === "png") return image.png({ compressionLevel: 9 }).toBuffer();
  return image.webp({ quality: 82 }).toBuffer();
}

/**
 * Master plan (§7.1): display image longest edge ≤ 5,000 px plus a 1,024 px
 * thumbnail. The normalized display keeps the aspect ratio the polygons were
 * drawn against, which is why it — not the raw upload — defines width/height.
 */
async function processMasterPlan(input: Buffer): Promise<ProcessedImage> {
  const display = await toBuffer(
    pipeline(input).resize({
      width: 5000,
      height: 5000,
      fit: "inside",
      withoutEnlargement: true,
    }),
    "webp",
  );
  const thumb = await toBuffer(
    pipeline(input).resize({
      width: 1024,
      height: 1024,
      fit: "inside",
      withoutEnlargement: true,
    }),
    "webp",
  );
  const meta = await sharp(display).metadata();
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    display: {
      suffix: "-display.webp",
      data: display,
      contentType: "image/webp",
    },
    derivatives: [
      { suffix: "-display.webp", data: display, contentType: "image/webp" },
      { suffix: "-thumb.webp", data: thumb, contentType: "image/webp" },
    ],
  };
}

/** Company logo (§7.1): normalized PNG, ≤ 1,200 px wide. */
async function processCompanyLogo(input: Buffer): Promise<ProcessedImage> {
  const display = await toBuffer(
    pipeline(input).resize({ width: 1200, withoutEnlargement: true }),
    "png",
  );
  const meta = await sharp(display).metadata();
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    display: {
      suffix: "-display.png",
      data: display,
      contentType: "image/png",
    },
    derivatives: [
      { suffix: "-display.png", data: display, contentType: "image/png" },
    ],
  };
}

/** Buyer photo (§7.1): 800 px max, JPEG q80, EXIF stripped; 96 px avatar. */
async function processBuyerPhoto(input: Buffer): Promise<ProcessedImage> {
  const display = await toBuffer(
    pipeline(input).resize({
      width: 800,
      height: 800,
      fit: "inside",
      withoutEnlargement: true,
    }),
    "jpeg",
  );
  const avatar = await toBuffer(
    pipeline(input).resize({ width: 96, height: 96, fit: "cover" }),
    "jpeg",
  );
  const meta = await sharp(display).metadata();
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    display: {
      suffix: "-display.jpg",
      data: display,
      contentType: "image/jpeg",
    },
    derivatives: [
      { suffix: "-display.jpg", data: display, contentType: "image/jpeg" },
      { suffix: "-avatar.jpg", data: avatar, contentType: "image/jpeg" },
    ],
  };
}

/**
 * Decode + normalize. A decode failure or an over-limit image throws; the
 * upload command maps that to `422 FILE_UNREADABLE` (`API.md` COR-1).
 */
export async function processImage(
  kind: ImageKind,
  input: Buffer,
): Promise<ProcessedImage> {
  switch (kind) {
    case "MASTER_PLAN":
      return processMasterPlan(input);
    case "COMPANY_LOGO":
      return processCompanyLogo(input);
    case "BUYER_PHOTO":
      return processBuyerPhoto(input);
    default: {
      const exhaustive: never = kind;
      throw new Error(`unsupported image kind: ${String(exhaustive)}`);
    }
  }
}

/** `variant` → derivative suffix; `original` has none (`API.md` COR-2). */
export function derivativeForVariant(
  kind: ImageKind,
  variant: "original" | "display" | "thumb" | "avatar",
): { suffix: string; contentType: string } | null {
  if (variant === "original") return null;
  if (variant === "avatar") {
    return kind === "BUYER_PHOTO"
      ? { suffix: "-avatar.jpg", contentType: "image/jpeg" }
      : null;
  }
  if (variant === "thumb") {
    return kind === "MASTER_PLAN"
      ? { suffix: "-thumb.webp", contentType: "image/webp" }
      : null;
  }
  const processed: Record<ImageKind, string> = {
    MASTER_PLAN: "-display.webp",
    COMPANY_LOGO: "-display.png",
    BUYER_PHOTO: "-display.jpg",
  };
  return {
    suffix: processed[kind],
    contentType:
      kind === "COMPANY_LOGO"
        ? "image/png"
        : kind === "BUYER_PHOTO"
          ? "image/jpeg"
          : "image/webp",
  };
}
