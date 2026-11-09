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
  normalizeNchw,
  resizeNormFixed,
  resizeRgb,
  rot180,
  rot90ccw,
  rotateRgb,
  unrotatePoint,
  warpQuad,
} from "./image";
import type { OcrBox, OcrDeps, OcrProgress, OcrResult, Point, RgbImage } from "./types";

const DET_THRESH = 0.3;
const BOX_THRESH = 0.5;
const UNCLIP_RATIO = 1.6;
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
  const target = detTargetSize(image.width, image.height);
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

function cropBox(image: RgbImage, points: Point[]): RgbImage | null {
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
  if (width < 2 || height < 2) return null;
  let crop = warpQuad(image, points, width, height);
  if (crop.height / Math.max(crop.width, 1) >= 1.5) crop = rot90ccw(crop);
  return crop;
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

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function isSideways(boxes: RawBox[]): boolean {
  if (boxes.length < 1) return false;
  const ratios = boxes.map((box) => {
    const { width, height } = edgeLengths(box.points);
    return width / Math.max(height, 1);
  });
  return median(ratios) < 1;
}

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
  const lines: { cy: number; h: number; items: typeof items }[] = [];
  for (const item of items) {
    let placed = false;
    for (const line of lines) {
      if (Math.abs(item.cy - line.cy) < Math.max(item.h, line.h) * 0.32) {
        line.items.push(item);
        line.cy = (line.cy * (line.items.length - 1) + item.cy) / line.items.length;
        line.h = Math.max(line.h, item.h);
        placed = true;
        break;
      }
    }
    if (!placed) lines.push({ cy: item.cy, h: item.h, items: [item] });
  }
  return lines.map((line) => {
    line.items.sort((a, b) => a.left - b.left);
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
    const cls = await classifyCrop(crop, deps);
    const turned = cls.label === 1 && cls.score > CLS_THRESH;
    const prepared = turned ? rot180(crop) : crop;
    if (turned) upsideDown++;
    const rec = await recognizeCrop(prepared, deps);
    const text = rec.text.trim();
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
    const text = joinFragments(line.fragments).trim();
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
  if (isSideways(first)) {
    onProgress?.({ ratio: 0.28, message: "正在校正图片方向" });
    let best: { image: RgbImage; rotation: 90 | 270; boxes: RawBox[] } | null = null;
    for (const turn of [90, 270] as const) {
      const turned = rotateRgb(image, turn);
      const boxes = await runDet(turned, deps);
      if (!boxes.length) continue;
      const ratios = boxes.map((box) => {
        const size = edgeLengths(box.points);
        return size.width / Math.max(size.height, 1);
      });
      const score = median(ratios) * boxes.length;
      const bestRatios = best
        ? median(
            best.boxes.map((box) => {
              const size = edgeLengths(box.points);
              return size.width / Math.max(size.height, 1);
            }),
          ) * best.boxes.length
        : -1;
      if (!best || score > bestRatios) best = { image: turned, rotation: turn, boxes };
    }
    if (best && best.boxes.length) {
      working = best.image;
      rotation = best.rotation;
      boxes = best.boxes;
    }
  }
  const read = await readImage(working, boxes, deps, onProgress, rotation === 0 ? 0.4 : 0.45);
  onProgress?.({ ratio: 1, message: "识别完成" });
  return assemble(read.fragments, image.width, image.height, rotation);
}
