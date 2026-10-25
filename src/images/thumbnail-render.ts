import { DESKTOP_RESOURCE_BUDGET, type RuntimeResourceBudget } from "../runtime/resource-budget";
import { readImageHeader, thumbnailDimensions } from "./image-header";
import type { ThumbnailResult } from "./types";
export async function generateThumbnail(buffer: ArrayBuffer, onEligible: () => void, budget: RuntimeResourceBudget["image"] = DESKTOP_RESOURCE_BUDGET.image): Promise<ThumbnailResult> {
  const header = readImageHeader(buffer, budget);
  if (!header) return { status: "skipped" };
  onEligible();
  let bitmap: ImageBitmap | null = null;
  let canvas: OffscreenCanvas | null = null;
  try {
    const dimensions = thumbnailDimensions(header, budget);
    bitmap = await createImageBitmap(new Blob([buffer], { type: header.mime }), {
      imageOrientation: "from-image", resizeWidth: dimensions.width, resizeHeight: dimensions.height,
      resizeQuality: "high",
    });
    canvas = new OffscreenCanvas(dimensions.width, dimensions.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No offscreen context");
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    let blob: Blob;
    try { blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.85 }); }
    catch { blob = await canvas.convertToBlob({ type: "image/png" }); }
    return { status: "ready", blob };
  } catch { return { status: "failed" }; }
  finally { bitmap?.close(); if (canvas) { canvas.width = 0; canvas.height = 0; } }
}
