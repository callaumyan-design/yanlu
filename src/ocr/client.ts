import { recognizeImage } from "./pipeline";
import { rgbaToRgb } from "./image";
import type { OcrDeps, OcrProgress, OcrResult, RgbaImage } from "./types";
import { createBrowserDeps } from "@/runtime/browser";

let depsPromise: Promise<OcrDeps> | null = null;

export async function recognizeRgba(
  image: RgbaImage,
  onProgress?: (progress: OcrProgress) => void,
): Promise<OcrResult> {
  if (!depsPromise) {
    depsPromise = createBrowserDeps(onProgress).catch((error: unknown) => {
      depsPromise = null;
      throw error;
    });
  }
  const deps = await depsPromise;
  return recognizeImage(rgbaToRgb(image), deps, onProgress);
}

export async function fileToRgba(file: Blob): Promise<{ image: RgbaImage; previewUrl: string }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = await createImageBitmap(file);
  }
  const maxSide = 4096;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("无法读取这张图片");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const pixels = context.getImageData(0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("无法读取这张图片"))), "image/png");
  });
  return {
    image: { width, height, data: pixels.data },
    previewUrl: URL.createObjectURL(blob),
  };
}
