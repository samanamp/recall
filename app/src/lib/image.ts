/**
 * Client-side image optimization at paste/drop time. Flashcard images never
 * need more than screen-sized WebP, and shrinking here means the repo,
 * the sync transfer, and every device's IndexedDB all win.
 */

// Target: a ~500px-wide mobile screen at 2x DPR. Text in screenshots stays
// legible on Retina; files land roughly half the size of the old 1400px cap.
const MAX_DIM = 1000;
const WEBP_QUALITY = 0.8;
const JPEG_QUALITY = 0.85; // Safari fallback when WebP encode is unsupported

export async function optimizeImage(input: Blob): Promise<{ blob: Blob; ext: string }> {
  // Re-encoding would destroy animation/vectors — pass through.
  if (input.type === "image/gif") return { blob: input, ext: "gif" };
  if (input.type === "image/svg+xml") return { blob: input, ext: "svg" };

  try {
    const bitmap = await createImageBitmap(input);
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    let out = await canvas.convertToBlob({ type: "image/webp", quality: WEBP_QUALITY });
    if (out.type !== "image/webp") {
      out = await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
    }

    // Tiny inputs can re-encode larger; keep the original when it wins.
    if (out.size >= input.size && scale === 1) return passthrough(input);
    return { blob: out, ext: out.type === "image/webp" ? "webp" : "jpg" };
  } catch {
    return passthrough(input); // not decodable as an image — store as-is
  }
}

function passthrough(input: Blob): { blob: Blob; ext: string } {
  const ext = input.type.split("/")[1]?.replace("jpeg", "jpg").replace("+xml", "") || "png";
  return { blob: input, ext };
}

/** Short content hash — identical images get identical paths (dedupe). */
export async function contentHash(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)]
    .slice(0, 10)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
