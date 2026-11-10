import type { Point, RgbImage, RgbaImage } from "./types";

export function rgbaToRgb(image: RgbaImage): RgbImage {
  const { width, height } = image;
  const src = image.data;
  const data = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < src.length; i += 4, j += 3) {
    const a = src[i + 3] / 255;
    data[j] = Math.round(src[i] * a + 255 * (1 - a));
    data[j + 1] = Math.round(src[i + 1] * a + 255 * (1 - a));
    data[j + 2] = Math.round(src[i + 2] * a + 255 * (1 - a));
  }
  return { width, height, data };
}

function clampIndex(v: number, max: number): number {
  if (v < 0) return 0;
  if (v > max) return max;
  return v;
}

/** Bilinear resize using the same pixel-center mapping as OpenCV INTER_LINEAR. */
export function resizeRgb(src: RgbImage, width: number, height: number): RgbImage {
  if (width === src.width && height === src.height) return src;
  if (width < 1 || height < 1) {
    throw new Error("目标尺寸无效");
  }
  const data = new Uint8Array(width * height * 3);
  const scaleX = src.width / width;
  const scaleY = src.height / height;
  const sw = src.width;
  const sh = src.height;
  for (let y = 0; y < height; y++) {
    const sy = (y + 0.5) * scaleY - 0.5;
    const y0 = Math.floor(sy);
    const wy = sy - y0;
    const y0c = clampIndex(y0, sh - 1);
    const y1c = clampIndex(y0 + 1, sh - 1);
    for (let x = 0; x < width; x++) {
      const sx = (x + 0.5) * scaleX - 0.5;
      const x0 = Math.floor(sx);
      const wx = sx - x0;
      const x0c = clampIndex(x0, sw - 1);
      const x1c = clampIndex(x0 + 1, sw - 1);
      const i00 = (y0c * sw + x0c) * 3;
      const i10 = (y0c * sw + x1c) * 3;
      const i01 = (y1c * sw + x0c) * 3;
      const i11 = (y1c * sw + x1c) * 3;
      const o = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) {
        const top = src.data[i00 + c] * (1 - wx) + src.data[i10 + c] * wx;
        const bot = src.data[i01 + c] * (1 - wx) + src.data[i11 + c] * wx;
        data[o + c] = Math.round(top * (1 - wy) + bot * wy);
      }
    }
  }
  return { width, height, data };
}

export function pyRound(n: number): number {
  const floor = Math.floor(n);
  const diff = n - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** PP-OCRv5 det resize: cap the long side, then snap both sides to a multiple of 32. */
export function detTargetSize(
  width: number,
  height: number,
  limit = 960,
): { width: number; height: number } {
  const maxSide = Math.max(width, height);
  const ratio = maxSide > limit ? limit / maxSide : 1;
  let rw = Math.max(32, pyRound((width * ratio) / 32) * 32);
  let rh = Math.max(32, pyRound((height * ratio) / 32) * 32);
  const cap = 1600;
  if (Math.max(rw, rh) > cap) {
    const r2 = cap / Math.max(rw, rh);
    rw = Math.max(32, pyRound((rw * r2) / 32) * 32);
    rh = Math.max(32, pyRound((rh * r2) / 32) * 32);
  }
  return { width: rw, height: rh };
}

export function normalizeNchw(image: RgbImage): Float32Array {
  const plane = image.width * image.height;
  const out = new Float32Array(3 * plane);
  const src = image.data;
  for (let i = 0, p = 0; i < src.length; i += 3, p++) {
    out[p] = (src[i] / 255 - 0.5) / 0.5;
    out[plane + p] = (src[i + 1] / 255 - 0.5) / 0.5;
    out[2 * plane + p] = (src[i + 2] / 255 - 0.5) / 0.5;
  }
  return out;
}

function rotatePointSource(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: 0 | 90 | 180 | 270,
): { sx: number; sy: number } {
  if (rotation === 90) return { sx: y, sy: height - 1 - x };
  if (rotation === 180) return { sx: width - 1 - x, sy: height - 1 - y };
  if (rotation === 270) return { sx: width - 1 - y, sy: x };
  return { sx: x, sy: y };
}

export function rotateRgb(image: RgbImage, rotation: 0 | 90 | 180 | 270): RgbImage {
  if (rotation === 0) return image;
  const width = rotation === 180 ? image.width : image.height;
  const height = rotation === 180 ? image.height : image.width;
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { sx, sy } = rotatePointSource(x, y, image.width, image.height, rotation);
      const si = (sy * image.width + sx) * 3;
      const di = (y * width + x) * 3;
      data[di] = image.data[si];
      data[di + 1] = image.data[si + 1];
      data[di + 2] = image.data[si + 2];
    }
  }
  return { width, height, data };
}

/** Map a point on a rotated working image back to the original image. */
export function unrotatePoint(
  point: Point,
  originalWidth: number,
  originalHeight: number,
  rotation: 0 | 90 | 180 | 270,
): Point {
  if (rotation === 90) {
    return { x: point.y, y: originalHeight - 1 - point.x };
  }
  if (rotation === 270) {
    return { x: originalWidth - 1 - point.y, y: point.x };
  }
  if (rotation === 180) {
    return { x: originalWidth - 1 - point.x, y: originalHeight - 1 - point.y };
  }
  return { x: point.x, y: point.y };
}

/** Counter-clockwise quarter turn, matching numpy.rot90. */
export function rot90ccw(image: RgbImage): RgbImage {
  return rotateRgb(image, 270);
}

export function rot180(image: RgbImage): RgbImage {
  return rotateRgb(image, 180);
}

function solve8(a: Float64Array, b: Float64Array): Float64Array {
  const n = 8;
  const m = new Float64Array(n * (n + 1));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) m[r * (n + 1) + c] = a[r * n + c];
    m[r * (n + 1) + n] = b[r];
  }
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(m[col * (n + 1) + col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(m[r * (n + 1) + col]);
      if (v > best) {
        best = v;
        pivot = r;
      }
    }
    if (best < 1e-12) throw new Error("透视变换无法求解");
    if (pivot !== col) {
      for (let c = col; c <= n; c++) {
        const i = col * (n + 1) + c;
        const j = pivot * (n + 1) + c;
        const tmp = m[i];
        m[i] = m[j];
        m[j] = tmp;
      }
    }
    const div = m[col * (n + 1) + col];
    for (let c = col; c <= n; c++) m[col * (n + 1) + c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r * (n + 1) + col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) {
        m[r * (n + 1) + c] -= factor * m[col * (n + 1) + c];
      }
    }
  }
  const x = new Float64Array(n);
  for (let r = 0; r < n; r++) x[r] = m[r * (n + 1) + n];
  return x;
}

function invert3(h: Float64Array): Float64Array {
  const [a, b, c, d, e, f, g, i, j] = h;
  const A = e * j - f * i;
  const B = f * g - d * j;
  const C = d * i - e * g;
  const D = c * i - b * j;
  const E = a * j - c * g;
  const F = b * g - a * i;
  const G = b * f - c * e;
  const H = c * d - a * f;
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error("透视矩阵不可逆");
  const inv = 1 / det;
  return new Float64Array([A * inv, D * inv, G * inv, B * inv, E * inv, H * inv, C * inv, F * inv, I * inv]);
}

/** Perspective-warp `src` quad onto a width×height rectangle. Border pixels are replicated. */
export function warpQuad(src: RgbImage, quad: Point[], width: number, height: number): RgbImage {
  const dst = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const a = new Float64Array(64);
  const b = new Float64Array(8);
  for (let i = 0; i < 4; i++) {
    const x = quad[i].x;
    const y = quad[i].y;
    const u = dst[i].x;
    const v = dst[i].y;
    const r0 = i * 2 * 8;
    a[r0] = x;
    a[r0 + 1] = y;
    a[r0 + 2] = 1;
    a[r0 + 6] = -u * x;
    a[r0 + 7] = -u * y;
    b[i * 2] = u;
    const r1 = (i * 2 + 1) * 8;
    a[r1 + 3] = x;
    a[r1 + 4] = y;
    a[r1 + 5] = 1;
    a[r1 + 6] = -v * x;
    a[r1 + 7] = -v * y;
    b[i * 2 + 1] = v;
  }
  const h8 = solve8(a, b);
  const forward = new Float64Array([h8[0], h8[1], h8[2], h8[3], h8[4], h8[5], h8[6], h8[7], 1]);
  const inv = invert3(forward);
  const data = new Uint8Array(width * height * 3);
  const sw = src.width;
  const sh = src.height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = inv[6] * x + inv[7] * y + inv[8];
      const sx = (inv[0] * x + inv[1] * y + inv[2]) / w;
      const sy = (inv[3] * x + inv[4] * y + inv[5]) / w;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const wx = sx - x0;
      const wy = sy - y0;
      const x0c = clampIndex(x0, sw - 1);
      const x1c = clampIndex(x0 + 1, sw - 1);
      const y0c = clampIndex(y0, sh - 1);
      const y1c = clampIndex(y0 + 1, sh - 1);
      const i00 = (y0c * sw + x0c) * 3;
      const i10 = (y0c * sw + x1c) * 3;
      const i01 = (y1c * sw + x0c) * 3;
      const i11 = (y1c * sw + x1c) * 3;
      const o = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) {
        const top = src.data[i00 + c] * (1 - wx) + src.data[i10 + c] * wx;
        const bot = src.data[i01 + c] * (1 - wx) + src.data[i11 + c] * wx;
        data[o + c] = Math.round(top * (1 - wy) + bot * wy);
      }
    }
  }
  return { width, height, data };
}

export function resizeNormFixed(
  image: RgbImage,
  outHeight: number,
  outWidth: number,
): Float32Array {
  const ratio = image.width / Math.max(image.height, 1);
  const resizedW =
    Math.ceil(outHeight * ratio) > outWidth
      ? outWidth
      : Math.max(1, Math.ceil(outHeight * ratio));
  const resized = resizeRgb(image, resizedW, outHeight);
  const plane = outHeight * outWidth;
  const out = new Float32Array(3 * plane);
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < resizedW; x++) {
      const si = (y * resizedW + x) * 3;
      const p = y * outWidth + x;
      out[p] = (resized.data[si] / 255 - 0.5) / 0.5;
      out[plane + p] = (resized.data[si + 1] / 255 - 0.5) / 0.5;
      out[2 * plane + p] = (resized.data[si + 2] / 255 - 0.5) / 0.5;
    }
  }
  return out;
}

/** Pad an RGB image. `replicate` matches OpenCV BORDER_REPLICATE. */
export function padRgb(
  image: RgbImage,
  padX: number,
  padY: number,
  mode: "replicate" | "white" = "replicate",
): RgbImage {
  const padLeft = Math.max(0, Math.round(padX));
  const padTop = Math.max(0, Math.round(padY));
  if (padLeft === 0 && padTop === 0) return image;
  const width = image.width + padLeft * 2;
  const height = image.height + padTop * 2;
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 3;
      const inside =
        x >= padLeft && x < padLeft + image.width && y >= padTop && y < padTop + image.height;
      if (!inside && mode === "white") {
        data[di] = 255;
        data[di + 1] = 255;
        data[di + 2] = 255;
        continue;
      }
      const sx = clampIndex(x - padLeft, image.width - 1);
      const sy = clampIndex(y - padTop, image.height - 1);
      const si = (sy * image.width + sx) * 3;
      data[di] = image.data[si];
      data[di + 1] = image.data[si + 1];
      data[di + 2] = image.data[si + 2];
    }
  }
  return { width, height, data };
}

/**
 * Offset every edge of a clockwise quad outward by `margin` pixels
 * along its normal. Centroid scaling barely moves the long edges of a
 * wide, short text box, which is exactly when tall glyphs get clipped.
 */
export function inflateQuad(points: Point[], marginX: number, marginY: number = marginX): Point[] {
  if ((marginX <= 0 && marginY <= 0) || points.length < 3) return points;
  const n = points.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const p0 = points[i];
    const p1 = points[(i + 1) % n];
    area += p0.x * p1.y - p1.x * p0.y;
  }
  // Image coordinates (y down): clockwise quads have positive signed area.
  // Rotate the edge 90° so the normal points outward for either winding.
  const sign = area >= 0 ? 1 : -1;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i + n - 1) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    const d0x = curr.x - prev.x;
    const d0y = curr.y - prev.y;
    const d1x = next.x - curr.x;
    const d1y = next.y - curr.y;
    const l0 = Math.hypot(d0x, d0y) || 1;
    const l1 = Math.hypot(d1x, d1y) || 1;
    const n0x = (sign * d0y) / l0;
    const n0y = (sign * -d0x) / l0;
    const n1x = (sign * d1y) / l1;
    const n1y = (sign * -d1x) / l1;
    // Long (horizontal) edges get the vertical margin; short edges get the side margin.
    const m0 = Math.abs(d0x) >= Math.abs(d0y) ? marginY : marginX;
    const m1 = Math.abs(d1x) >= Math.abs(d1y) ? marginY : marginX;
    out.push({
      x: curr.x + m0 * n0x + m1 * n1x,
      y: curr.y + m0 * n0y + m1 * n1y,
    });
  }
  return out;
}

function lumaAt(image: RgbImage, x: number, y: number): number {
  const i = (y * image.width + x) * 3;
  return 0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2];
}

/** Tight box around pixels that differ from the corner background, plus padding. */
export function inkBoundingBox(
  image: RgbImage,
  pad = 6,
): { x: number; y: number; width: number; height: number } | null {
  const { width, height, data } = image;
  if (width < 2 || height < 2) return null;
  const corners = [
    lumaAt(image, 0, 0),
    lumaAt(image, width - 1, 0),
    lumaAt(image, 0, height - 1),
    lumaAt(image, width - 1, height - 1),
  ];
  const bg = (corners[0] + corners[1] + corners[2] + corners[3]) / 4;
  const thresh = 28;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (Math.abs(luma - bg) < thresh) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  const x = Math.max(0, minX - pad);
  const y = Math.max(0, minY - pad);
  const w = Math.min(width, maxX + 1 + pad) - x;
  const h = Math.min(height, maxY + 1 + pad) - y;
  if (w < 2 || h < 2) return null;
  return { x, y, width: w, height: h };
}

export function cropRgb(
  image: RgbImage,
  x: number,
  y: number,
  width: number,
  height: number,
): RgbImage {
  const data = new Uint8Array(width * height * 3);
  for (let row = 0; row < height; row++) {
    const sy = Math.min(image.height - 1, Math.max(0, y + row));
    for (let col = 0; col < width; col++) {
      const sx = Math.min(image.width - 1, Math.max(0, x + col));
      const si = (sy * image.width + sx) * 3;
      const di = (row * width + col) * 3;
      data[di] = image.data[si];
      data[di + 1] = image.data[si + 1];
      data[di + 2] = image.data[si + 2];
    }
  }
  return { width, height, data };
}

/** True when the image border is a fairly uniform page/background. */
export function borderIsPlain(image: RgbImage): boolean {
  const { width, height } = image;
  const samples: number[] = [];
  const band = Math.max(1, Math.min(6, Math.floor(Math.min(width, height) / 20)));
  const push = (x: number, y: number) => samples.push(lumaAt(image, x, y));
  for (let x = 0; x < width; x += 2) {
    for (let t = 0; t < band; t++) {
      push(x, t);
      push(x, height - 1 - t);
    }
  }
  for (let y = 0; y < height; y += 2) {
    for (let t = 0; t < band; t++) {
      push(t, y);
      push(width - 1 - t, y);
    }
  }
  if (samples.length < 8) return false;
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  let varSum = 0;
  for (const v of samples) varSum += (v - mean) * (v - mean);
  return Math.sqrt(varSum / samples.length) < 22;
}
