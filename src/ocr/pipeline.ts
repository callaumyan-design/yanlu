import { assertDict } from "./dict";
import {
  boundaryComponents,
  dilate2x2,
  expandPolygon,
  meanInsidePolygon,
  minAreaRect,
  orderClockwise,
  orderMiniBox,
} from "./geometry";
import {
  detTargetSize,
  borderIsPlain,
  cropRgb,
  inflateQuad,
  inkBoundingBox,
  normalizeNchw,
  padRgb,
  resizeNormFixed,
  resizeRgb,
  rot180,
  rot90ccw,
  rotateRgb,
  unrotatePoint,
  warpQuad,
} from "./image";
import { restoreOcrSpaces } from "./text";
import type { OcrBox, OcrDeps, OcrProgress, OcrResult, Point, RgbImage } from "./types";

const DET_THRESH = 0.3;
const BOX_THRESH = 0.5;
const UNCLIP_RATIO = 1.75;
const MIN_SIZE = 3;
const CLS_THRESH = 0.9;

interface RawBox {
  points: Point[];
  score: number;
}

function edgeLengths(box: Point[]): { width: number; height: number } {
  const width = Math.hypot(box[1].x - box[0].x, box[1].y - box[0].y);
  const height = Math.hypot(box[3].x - box[0].x, box[3].y - box[0].y);
  return { width, height };
}

function detectBoxes(prob: Float32Array, width: number, height: number, destWidth: number, destHeight: number): RawBox[] {
  const binary = new Uint8Array(width * height);
  for (let i = 0; i < binary.length; i++) binary[i] = prob[i] > DET_THRESH ? 1 : 0;
  const mask = dilate2x2(binary, width, height);
  const components = boundaryComponents(mask, width, height);
  const boxes: RawBox[] = [];
  const limit = Math.min(components.length, 1000);
  for (let i = 0; i < limit; i++) {
    const rect = minAreaRect(components[i]);
    const short = Math.min(rect.width, rect.height);
    if (short < MIN_SIZE || rect.corners.length < 4) continue;
    const mini = orderMiniBox(rect.corners);
    const score = meanInsidePolygon(prob, width, height, mini);
    if (score < BOX_THRESH) continue;
    const expanded = expandPolygon(mini, UNCLIP_RATIO);
    if (!expanded || expanded.length < 3) continue;
    const expandedRect = minAreaRect(expanded);
    if (Math.min(expandedRect.width, expandedRect.height) < MIN_SIZE + 2) continue;
    const scaled = orderMiniBox(expandedRect.corners).map((p) => ({
      x: Math.min(destWidth, Math.max(0, Math.round((p.x / width) * destWidth))),
      y: Math.min(destHeight, Math.max(0, Math.round((p.y / height) * destHeight))),
    }));
    const ordered = orderClockwise(scaled).map((p) => ({
      x: Math.min(destWidth - 1, Math.max(0, p.x)),
      y: Math.min(destHeight - 1, Math.max(0, p.y)),
    }));
    const size = edgeLengths(ordered);
    if (size.width <= 3 || size.height <= 3) continue;
    boxes.push({ points: ordered, score });
  }
  return boxes;
}

async function runDet(image: RgbImage, deps: OcrDeps): Promise<RawBox[]> {
  const target = detTargetSize(image.width, image.height, 1280);
  const resized = resizeRgb(image, target.width, target.height);
  const input = normalizeNchw(resized);
  const output = await deps.det.run(input, [1, 3, resized.height, resized.width]);
  if (output.dims.length !== 4) {
    throw new Error(`检测模型输出维度异常: ${output.dims.join("x")}`);
  }
  const outH = output.dims[2];
  const outW = output.dims[3];
  const prob = output.data.subarray(0, outH * outW);
  return detectBoxes(prob, outW, outH, image.width, image.height);
}

function boxSize(points: Point[]): { width: number; height: number } {
  const width = Math.max(
    1,
    Math.round(
      Math.max(
        Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
        Math.hypot(points[2].x - points[3].x, points[2].y - points[3].y),
      ),
    ),
  );
  const height = Math.max(
    1,
    Math.round(
      Math.max(
        Math.hypot(points[0].x - points[3].x, points[0].y - points[3].y),
        Math.hypot(points[1].x - points[2].x, points[1].y - points[2].y),
      ),
    ),
  );
  return { width, height };
}

function finalizeCrop(crop: RgbImage): RgbImage {
  if (crop.height / Math.max(crop.width, 1) >= 1.5) return rot90ccw(crop);
  return crop;
}

function cropBox(image: RgbImage, points: Point[]): RgbImage | null {
  const raw = boxSize(points);
  if (raw.width < 2 || raw.height < 2) return null;
  return finalizeCrop(warpQuad(image, points, raw.width, raw.height));
}

/** Expand a short box so tall/thin glyphs like 高 and 小 are not clipped. */
function cropBoxInflated(image: RgbImage, points: Point[]): RgbImage | null {
  const raw = boxSize(points);
  if (raw.width < 2 || raw.height < 2) return null;
  const ratio = raw.width / Math.max(raw.height, 1);
  const marginY = ratio >= 16 ? Math.max(6, Math.min(8, Math.round(raw.height * 0.2))) : Math.max(4, Math.min(6, Math.round(raw.height * 0.15)));
  const expanded = inflateQuad(points, 2, marginY);
  const size = boxSize(expanded);
  const crop = finalizeCrop(warpQuad(image, expanded, size.width, size.height));
  return ratio >= 16 ? padRgb(crop, 2, 2, "replicate") : crop;
}

function recRank(rec: { text: string; score: number }): number {
  // Prefer complete glyphs (higher confidence * a mild length bonus) so a clipped
  // 高 does not beat a slightly lower-scoring but complete crop.
  const len = rec.text.replace(/\s+/g, "").length;
  return rec.score * Math.log(2 + len);
}

async function classifyCrop(crop: RgbImage, deps: OcrDeps): Promise<{ label: number; score: number }> {
  const input = resizeNormFixed(crop, 80, 160);
  const output = await deps.cls.run(input, [1, 3, 80, 160]);
  const a = output.data[0] ?? 0;
  const b = output.data[1] ?? 0;
  if (b > a) return { label: 1, score: b };
  return { label: 0, score: a };
}

function ctcDecode(probs: Float32Array, timeSteps: number, classes: number, dict: string[]): { text: string; score: number } {
  let prev = -1;
  let text = "";
  let scoreSum = 0;
  let count = 0;
  for (let t = 0; t < timeSteps; t++) {
    let best = 0;
    let bestV = -Infinity;
    const offset = t * classes;
    for (let c = 0; c < classes; c++) {
      const v = probs[offset + c];
      if (v > bestV) {
        bestV = v;
        best = c;
      }
    }
    if (best === 0 || best === prev) {
      prev = best;
      continue;
    }
    prev = best;
    const ch = dict[best];
    if (ch) {
      text += ch;
      scoreSum += bestV;
      count++;
    }
  }
  return { text, score: count ? scoreSum / count : 0 };
}

async function recognizeCrop(crop: RgbImage, deps: OcrDeps): Promise<{ text: string; score: number }> {
  const ratio = crop.width / Math.max(crop.height, 1);
  const maxWh = Math.min(Math.max(ratio, 320 / 48), 2048 / 48);
  const width = Math.max(8, Math.round(48 * maxWh));
  const input = resizeNormFixed(crop, 48, width);
  const output = await deps.rec.run(input, [1, 3, 48, width]);
  const dims = output.dims;
  const classes = dims[dims.length - 1];
  const timeSteps = dims.length === 3 ? dims[1] : output.data.length / classes;
  return ctcDecode(output.data, timeSteps, classes, deps.dict);
}

// Page-level 90/270 rotation was removed. It used the median box aspect, so a
// table of narrow digits or an upright vertical plaque was treated as a sideways
// photo. Per-crop rotation already turns tall text lines horizontal, and on the
// 46-image set that is enough for real 90-degree photos. The page rotation made
// vertical loose CER 0.0566 -> 0.1509 and turned the medal-table digits sideways.

interface Fragment {
  text: string;
  score: number;
  points: Point[];
  upsideDown: boolean;
}

interface LineGroup {
  fragments: Fragment[];
}

function groupLines(fragments: Fragment[]): LineGroup[] {
  const items = fragments.map((fragment) => {
    const ys = fragment.points.map((p) => p.y);
    const xs = fragment.points.map((p) => p.x);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    return {
      fragment,
      top,
      bottom,
      left,
      right,
      cy: (top + bottom) / 2,
      h: Math.max(8, bottom - top),
    };
  });
  items.sort((a, b) => a.top - b.top || a.left - b.left);
  const columnLike = (item: (typeof items)[number]) => item.h > Math.max(40, (item.right - item.left) * 1.8);
  const sameColumn = (a: (typeof items)[number], b: (typeof items)[number]) => {
    const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const width = Math.min(a.right - a.left, b.right - b.left);
    return width > 0 && overlap / width > 0.45;
  };
  const lines: { cy: number; h: number; items: typeof items }[] = [];
  for (const item of items) {
    let placed = false;
    if (columnLike(item)) {
      // Stack fragments of one vertical strip. Do not merge neighboring columns.
      for (const line of lines) {
        if (!line.items.every(columnLike)) continue;
        if (line.items.some((other) => sameColumn(item, other))) {
          line.items.push(item);
          line.cy = (line.cy * (line.items.length - 1) + item.cy) / line.items.length;
          line.h = Math.max(line.h, item.h);
          placed = true;
          break;
        }
      }
    } else {
      for (const line of lines) {
        if (line.items.some(columnLike)) continue;
        if (Math.abs(item.cy - line.cy) < Math.max(item.h, line.h) * 0.32) {
          line.items.push(item);
          line.cy = (line.cy * (line.items.length - 1) + item.cy) / line.items.length;
          line.h = Math.max(line.h, item.h);
          placed = true;
          break;
        }
      }
    }
    if (!placed) lines.push({ cy: item.cy, h: item.h, items: [item] });
  }
  const columns = lines.filter((line) => line.items.every(columnLike));
  if (columns.length >= 2 && columns.length === lines.length) {
    lines.sort((a, b) => b.items[0].left - a.items[0].left);
  }
  return lines.map((line) => {
    if (line.items.every(columnLike)) line.items.sort((a, b) => a.top - b.top);
    else line.items.sort((a, b) => a.left - b.left);
    return { fragments: line.items.map((item) => item.fragment) };
  });
}

function joinFragments(fragments: Fragment[]): string {
  let text = "";
  for (let i = 0; i < fragments.length; i++) {
    if (i > 0) {
      const prev = fragments[i - 1].points;
      const curr = fragments[i].points;
      const prevRight = Math.max(...prev.map((p) => p.x));
      const currLeft = Math.min(...curr.map((p) => p.x));
      const height = Math.max(...prev.map((p) => p.y)) - Math.min(...prev.map((p) => p.y));
      if (currLeft - prevRight > Math.max(8, height) * 0.45) text += " ";
    }
    text += fragments[i].text;
  }
  return text;
}

function preferAlternate(base: { text: string; score: number }, alt: { text: string; score: number }): boolean {
  const baseLen = base.text.replace(/\s+/g, "").length;
  const altLen = alt.text.replace(/\s+/g, "").length;
  // A clipped glyph usually shortens the line; keep the longer crop when its
  // confidence is still in a reasonable band of the tight crop.
  if (altLen > baseLen && alt.score >= Math.min(0.5, base.score * 0.8)) return true;
  if (altLen < baseLen && base.score >= Math.min(0.5, alt.score * 0.8)) return false;
  return recRank(alt) > recRank(base);
}

async function recognizePrepared(
  crop: RgbImage,
  deps: OcrDeps,
): Promise<{ rec: { text: string; score: number }; turned: boolean }> {
  const cls = await classifyCrop(crop, deps);
  const turned = cls.label === 1 && cls.score > CLS_THRESH;
  const prepared = turned ? rot180(crop) : crop;
  const rec = await recognizeCrop(prepared, deps);
  return { rec, turned };
}

async function readImage(
  image: RgbImage,
  boxes: RawBox[],
  deps: OcrDeps,
  onProgress?: (progress: OcrProgress) => void,
  ratioBase = 0.35,
): Promise<{ fragments: Fragment[]; upsideDown: number; total: number }> {
  const fragments: Fragment[] = [];
  let upsideDown = 0;
  for (let i = 0; i < boxes.length; i++) {
    onProgress?.({
      ratio: ratioBase + 0.55 * ((i + 1) / Math.max(boxes.length, 1)),
      message: `正在识别 ${i + 1}/${boxes.length}`,
    });
    const crop = cropBox(image, boxes[i].points);
    if (!crop) continue;
    const recOne = await recognizePrepared(crop, deps);
    let rec = recOne.rec;
    let turned = recOne.turned;
    const raw = boxSize(boxes[i].points);
    if (raw.height < 40) {
      const alt = cropBoxInflated(image, boxes[i].points);
      if (alt) {
        const recTwo = await recognizePrepared(alt, deps);
        if (preferAlternate(recOne.rec, recTwo.rec)) {
          rec = recTwo.rec;
          turned = recTwo.turned;
        }
      }
    }
    if (turned) upsideDown++;
    const text = restoreOcrSpaces(rec.text).trim();
    if (!text) continue;
    fragments.push({
      text,
      score: rec.score,
      points: boxes[i].points,
      upsideDown: turned,
    });
  }
  return { fragments, upsideDown, total: fragments.length };
}

function assemble(
  fragments: Fragment[],
  sourceWidth: number,
  sourceHeight: number,
  rotation: 0 | 90 | 180 | 270,
): OcrResult {
  let lines = groupLines(fragments);
  const upsideDown = fragments.filter((fragment) => fragment.upsideDown).length;
  if (fragments.length > 0 && upsideDown * 2 >= fragments.length) {
    lines.reverse();
    lines = lines.map((line) => ({ fragments: line.fragments.slice().reverse() }));
  }
  const boxes: OcrBox[] = [];
  const texts: string[] = [];
  let scoreSum = 0;
  for (const line of lines) {
    const text = restoreOcrSpaces(joinFragments(line.fragments)).trim();
    if (!text) continue;
    texts.push(text);
    const score =
      line.fragments.reduce((sum, fragment) => sum + fragment.score, 0) /
      Math.max(line.fragments.length, 1);
    scoreSum += score;
    for (const fragment of line.fragments) {
      boxes.push({
        text: fragment.text,
        score: fragment.score,
        points: fragment.points.map((point) =>
          unrotatePoint(point, sourceWidth, sourceHeight, rotation),
        ),
      });
    }
  }
  return {
    text: texts.join("\n"),
    boxes,
    meanScore: texts.length ? scoreSum / texts.length : 0,
  };
}

/**
 * PP-OCRv5 detection + text-line orientation + recognition.
 * Geometry follows the Apache-2.0 PaddleOCR / RapidOCR pipeline.
 */
function composeRotation(a: 0 | 90 | 180 | 270, b: 0 | 90 | 180 | 270): 0 | 90 | 180 | 270 {
  return ((a + b) % 360) as 0 | 90 | 180 | 270;
}

function readQuality(read: { fragments: Fragment[]; upsideDown: number; total: number }): number {
  const n = read.fragments.reduce((sum, fragment) => sum + fragment.text.replace(/\s+/g, "").length, 0);
  const score =
    read.fragments.reduce((sum, fragment) => sum + fragment.score, 0) / Math.max(read.total, 1);
  const up = read.upsideDown / Math.max(read.total, 1);
  return n * Math.max(score, 0.05) * (1 - 0.65 * up);
}

function isTextStrip(image: RgbImage): boolean {
  const shortSide = Math.min(image.width, image.height);
  const longSide = Math.max(image.width, image.height);
  return shortSide <= 180 || longSide / Math.max(shortSide, 1) >= 5;
}

async function recognizeInkLine(
  image: RgbImage,
  deps: OcrDeps,
): Promise<{ rec: { text: string; score: number }; turned: boolean; points: Point[] } | null> {
  const box = inkBoundingBox(image, 8) ?? { x: 0, y: 0, width: image.width, height: image.height };
  let crop = cropRgb(image, box.x, box.y, box.width, box.height);
  if (crop.height / Math.max(crop.width, 1) >= 1.5) crop = rot90ccw(crop);
  const prepared = await recognizePrepared(crop, deps);
  const text = restoreOcrSpaces(prepared.rec.text).trim();
  if (!text) return null;
  const points: Point[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
  return { rec: { text: prepared.rec.text, score: prepared.rec.score }, turned: prepared.turned, points };
}

/**
 * PP-OCRv5 detection + text-line orientation + recognition.
 * Geometry follows the Apache-2.0 PaddleOCR / RapidOCR pipeline.
 */
export async function recognizeImage(
  image: RgbImage,
  deps: OcrDeps,
  onProgress?: (progress: OcrProgress) => void,
): Promise<OcrResult> {
  assertDict(deps.dict);
  onProgress?.({ ratio: 0.2, message: "正在检测文字区域" });
  const first = await runDet(image, deps);
  let working = image;
  let rotation: 0 | 90 | 180 | 270 = 0;
  let boxes = first;
  let read = await readImage(working, boxes, deps, onProgress, 0.4);
  if (read.total > 0 && read.upsideDown * 2 >= read.total) {
    onProgress?.({ ratio: 0.38, message: "正在校正上下颠倒的页面" });
    const turned = rotateRgb(working, 180);
    const boxes180 = await runDet(turned, deps);
    const read180 = await readImage(turned, boxes180, deps, undefined, 0.55);
    if (readQuality(read180) > readQuality(read) * 1.02) {
      working = turned;
      rotation = composeRotation(rotation, 180);
      boxes = boxes180;
      read = read180;
    }
  }
  const strip = isTextStrip(working);
  const plain = borderIsPlain(working);
  const shouldFallback =
    boxes.length === 0 ||
    strip ||
    (plain && boxes.length <= 3);
  if (shouldFallback) {
    const fallback = await recognizeInkLine(working, deps);
    if (fallback) {
      const text = restoreOcrSpaces(fallback.rec.text).trim();
      const existing = read.fragments.map((fragment) => fragment.text).join("");
      const existingLoose = existing.replace(/\s+/g, "");
      const fallbackLoose = text.replace(/\s+/g, "");
      // Only replace a detected page when the fallback is clearly more complete.
      // A 2–3 box vertical page must not be collapsed into one rec crop.
      const existingWeak = existingLoose.length <= 8;
      const better =
        read.fragments.length === 0 ||
        (strip && fallbackLoose.length >= existingLoose.length && fallback.rec.score >= 0.55) ||
        (existingWeak && fallbackLoose.length > existingLoose.length && fallback.rec.score >= 0.55) ||
        (read.total <= 2 &&
          fallbackLoose.length > existingLoose.length * 1.2 &&
          fallback.rec.score >= 0.6);
      if (better && text) {
        read = {
          fragments: [
            {
              text,
              score: fallback.rec.score,
              points: fallback.points,
              upsideDown: fallback.turned,
            },
          ],
          upsideDown: fallback.turned ? 1 : 0,
          total: 1,
        };
      }
    }
  }
  onProgress?.({ ratio: 1, message: "识别完成" });
  return assemble(read.fragments, image.width, image.height, rotation);
}
