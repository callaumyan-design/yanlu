import ClipperLib from "clipper-lib";
import type { Point } from "./types";

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

export function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

export function convexHull(points: Point[]): Point[] {
  if (points.length <= 1) return points.slice();
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export interface MinRect {
  width: number;
  height: number;
  corners: Point[];
}

export function minAreaRect(points: Point[]): MinRect {
  const hull = convexHull(points);
  if (hull.length === 0) return { width: 0, height: 0, corners: [] };
  if (hull.length === 1) {
    return { width: 0, height: 0, corners: [hull[0], hull[0], hull[0], hull[0]] };
  }
  if (hull.length === 2) {
    const width = Math.hypot(hull[1].x - hull[0].x, hull[1].y - hull[0].y);
    return { width, height: 0, corners: [hull[0], hull[1], hull[1], hull[0]] };
  }
  let bestArea = Infinity;
  let best: MinRect = { width: 0, height: 0, corners: [] };
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const p = hull[i];
    const q = hull[(i + 1) % n];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const ux = dx / len;
    const uy = dy / len;
    const vx = -uy;
    const vy = ux;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const h of hull) {
      const u = h.x * ux + h.y * uy;
      const v = h.x * vx + h.y * vy;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const width = maxU - minU;
    const height = maxV - minV;
    const area = width * height;
    if (area < bestArea) {
      bestArea = area;
      const corners = [
        { x: minU * ux + minV * vx, y: minU * uy + minV * vy },
        { x: maxU * ux + minV * vx, y: maxU * uy + minV * vy },
        { x: maxU * ux + maxV * vx, y: maxU * uy + maxV * vy },
        { x: minU * ux + maxV * vx, y: minU * uy + maxV * vy },
      ];
      best = { width, height, corners };
    }
  }
  return best;
}

/** Same corner ordering as PaddleOCR / RapidOCR get_mini_boxes. */
export function orderMiniBox(corners: Point[]): Point[] {
  const points = corners.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  while (points.length < 4) points.push(points[points.length - 1] ?? { x: 0, y: 0 });
  const leftTop = points[1].y > points[0].y ? 0 : 1;
  const leftBottom = leftTop === 0 ? 1 : 0;
  const rightTop = points[3].y > points[2].y ? 2 : 3;
  const rightBottom = rightTop === 2 ? 3 : 2;
  return [points[leftTop], points[rightTop], points[rightBottom], points[leftBottom]];
}

export function orderClockwise(points: Point[]): Point[] {
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const left = sorted.slice(0, 2).sort((a, b) => a.y - b.y);
  const right = sorted.slice(2, 4).sort((a, b) => a.y - b.y);
  return [left[0], right[0], right[1], left[1]];
}

export function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    sum += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.abs(sum) / 2;
}

export function polygonPerimeter(points: Point[]): number {
  let length = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    length += Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
  }
  return length;
}

export function expandPolygon(points: Point[], ratio: number): Point[] | null {
  const area = polygonArea(points);
  const peri = polygonPerimeter(points);
  if (peri < 1e-3) return null;
  const distance = (area * ratio) / peri;
  const path = points.map((p) => ({ X: Math.trunc(p.x), Y: Math.trunc(p.y) }));
  const deduped: { X: number; Y: number }[] = [];
  for (const p of path) {
    const prev = deduped[deduped.length - 1];
    if (!prev || prev.X !== p.X || prev.Y !== p.Y) deduped.push(p);
  }
  if (deduped.length >= 2) {
    const first = deduped[0];
    const last = deduped[deduped.length - 1];
    if (first.X === last.X && first.Y === last.Y) deduped.pop();
  }
  if (deduped.length < 3) return null;
  const offset = new ClipperLib.ClipperOffset(2, 0.25);
  offset.AddPath(deduped, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const solution: { X: number; Y: number }[][] = [];
  offset.Execute(solution, distance);
  if (!solution.length) return null;
  let best = solution[0];
  let bestArea = -1;
  for (const poly of solution) {
    const pts = poly.map((p) => ({ x: p.X, y: p.Y }));
    const a = polygonArea(pts);
    if (a > bestArea) {
      bestArea = a;
      best = poly;
    }
  }
  return best.map((p) => ({ x: p.X, y: p.Y }));
}

/** 2×2 dilation matching OpenCV's default anchor (expands right and down). */
export function dilate2x2(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const here = mask[y * width + x];
      const left = x > 0 ? mask[y * width + (x - 1)] : 0;
      const up = y > 0 ? mask[(y - 1) * width + x] : 0;
      const upLeft = x > 0 && y > 0 ? mask[(y - 1) * width + (x - 1)] : 0;
      out[y * width + x] = here || left || up || upLeft ? 1 : 0;
    }
  }
  return out;
}

export function boundaryComponents(mask: Uint8Array, width: number, height: number): Point[][] {
  const seen = new Uint8Array(mask.length);
  const components: Point[][] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const points: Point[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const idx = stack.pop() as number;
      const x = idx % width;
      const y = (idx - x) / width;
      let boundary = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      for (let n = 0; n < NEIGHBORS.length; n++) {
        const nx = x + NEIGHBORS[n][0];
        const ny = y + NEIGHBORS[n][1];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          boundary = true;
          continue;
        }
        const ni = ny * width + nx;
        if (!mask[ni]) boundary = true;
        else if (!seen[ni]) {
          seen[ni] = 1;
          stack.push(ni);
        }
      }
      if (boundary) points.push({ x, y });
    }
    if (points.length) components.push(points);
  }
  return components;
}

export function meanInsidePolygon(
  values: Float32Array,
  width: number,
  height: number,
  polygon: Point[],
): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const xmin = Math.max(0, Math.floor(minX));
  const xmax = Math.min(width - 1, Math.ceil(maxX));
  const ymin = Math.max(0, Math.floor(minY));
  const ymax = Math.min(height - 1, Math.ceil(maxY));
  let sum = 0;
  let count = 0;
  for (let y = ymin; y <= ymax; y++) {
    const hits: number[] = [];
    const scanY = y + 0.5;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      if ((a.y <= scanY && b.y > scanY) || (b.y <= scanY && a.y > scanY)) {
        const t = (scanY - a.y) / (b.y - a.y);
        hits.push(a.x + t * (b.x - a.x));
      }
    }
    hits.sort((p, q) => p - q);
    for (let i = 0; i + 1 < hits.length; i += 2) {
      let x0 = Math.ceil(hits[i]);
      let x1 = Math.floor(hits[i + 1]);
      if (x0 < xmin) x0 = xmin;
      if (x1 > xmax) x1 = xmax;
      for (let x = x0; x <= x1; x++) {
        sum += values[y * width + x];
        count++;
      }
    }
  }
  return count ? sum / count : 0;
}
