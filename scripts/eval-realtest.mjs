import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { characterAccuracy, levenshtein, normalizeForAccuracy, strictCharacterAccuracy } from "../src/ocr/accuracy.ts";
import { rgbaToRgb } from "../src/ocr/image.ts";
import { recognizeImage } from "../src/ocr/pipeline.ts";
import { createNodeDeps } from "../src/runtime/node.ts";

const root = "/workspace/yanlu-realtest";
const labels = JSON.parse(await readFile(path.join(root, "labels.json"), "utf8"));
const outPath = process.argv[2] || path.join(root, "yanlu_eval.json");
const deps = await createNodeDeps(path.resolve("public/models"));

function loose(s) {
  return normalizeForAccuracy(s);
}
function strict(s) {
  return s.normalize("NFKC");
}

/** A GT line is a hit if some OCR loose text window has CER <= 0.3, or it is a substring. */

function bestWindowCER(gt, ocr) {
  if (!gt.length) return 0;
  if (!ocr.length) return 1;
  if (ocr.includes(gt)) return 0;
  let best = levenshtein(gt, ocr) / gt.length;
  if (ocr.length <= gt.length) return Math.min(1, best);
  const n = gt.length;
  const step = Math.max(1, Math.floor(n / 5));
  for (const win of [n, Math.min(ocr.length, Math.ceil(n * 1.25))]) {
    for (let i = 0; i <= ocr.length - win; i += step) {
      const d = levenshtein(gt, ocr.slice(i, i + win)) / n;
      if (d < best) best = d;
      if (best === 0) return 0;
    }
  }
  return Math.min(1, best);
}

function lineHit(gtLine, ocrText) {
  const g = loose(gtLine);
  if (!g) return true;
  const o = loose(ocrText);
  if (o.includes(g)) return true;
  // sliding windows around line length
  const n = g.length;
  if (o.length === 0) return false;
  let best = Infinity;
  if (o.length <= n) best = levenshtein(g, o) / n;
  else {
    for (let i = 0; i <= o.length - n; i += Math.max(1, Math.floor(n / 4))) {
      const d = levenshtein(g, o.slice(i, i + n));
      if (d / n < best) best = d / n;
      if (best <= 0.3) return true;
    }
    // also try slightly longer windows
    const n2 = Math.min(o.length, Math.ceil(n * 1.3));
    for (let i = 0; i <= o.length - n2; i += Math.max(1, Math.floor(n / 3))) {
      const d = levenshtein(g, o.slice(i, i + n2)) / n;
      if (d < best) best = d;
      if (best <= 0.3) return true;
    }
  }
  return best <= 0.3;
}

const cases = [];
for (const item of labels.items) {
  const file = path.join(root, "images", item.file);
  const t0 = Date.now();
  const decoded = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const image = rgbaToRgb({ width: decoded.info.width, height: decoded.info.height, data: decoded.data });
  const result = await recognizeImage(image, deps);
  const exp = item.text;
  const act = result.text;
  const expN = loose(exp), actN = loose(act);
  const expS = strict(exp), actS = strict(act);
  const dL = levenshtein(expN, actN);
  const dS = levenshtein(expS, actS);
  const lines = item.lines.filter((l) => loose(l).length >= 2);
  const missed = lines.filter((l) => !lineHit(l, act));
  let lineLooseD = 0, lineLooseN = 0, lineStrictD = 0, lineStrictN = 0;
  for (const line of lines) {
    const gL = loose(line), gS = strict(line);
    const bestL = bestWindowCER(gL, expN && actN ? actN : loose(act));
    const bestS = bestWindowCER(gS, actS);
    lineLooseD += bestL * gL.length;
    lineLooseN += gL.length;
    lineStrictD += bestS * gS.length;
    lineStrictN += gS.length;
  }
  const rec = {
    id: item.id,
    file: item.file,
    category: item.category,
    label_source: item.label_source,
    gt_coverage: item.gt_coverage,
    expected: exp,
    actual: act,
    boxes: result.boxes.length,
    meanScore: result.meanScore,
    ms: Date.now() - t0,
    pageLooseCER: expN.length ? dL / expN.length : 0,
    pageStrictCER: expS.length ? dS / expS.length : 0,
    looseCER: lineLooseN ? lineLooseD / lineLooseN : 0,
    strictCER: lineStrictN ? lineStrictD / lineStrictN : 0,
    lineLooseN,
    lineStrictN,
    lineCount: lines.length,
    lineMisses: missed.length,
    missedLines: missed,
  };
  cases.push(rec);
  const mark = rec.looseCER === 0 && rec.lineMisses === 0 ? "OK" : rec.lineMisses ? "MISS" : "ER";
  console.log(`${mark} ${item.file} loose=${rec.looseCER.toFixed(3)} strict=${rec.strictCER.toFixed(3)} lines=${lines.length} miss=${missed.length}`);
  if (missed.length) console.log("  missed:", JSON.stringify(missed.slice(0, 6), null, 0));
}

function aggregate(rows) {
  let lD = 0, lN = 0, sD = 0, sN = 0, lineN = 0, lineM = 0;
  for (const r of rows) {
    lD += r.looseCER * (r.lineLooseN || 0);
    lN += r.lineLooseN || 0;
    sD += r.strictCER * (r.lineStrictN || 0);
    sN += r.lineStrictN || 0;
    lineN += r.lineCount;
    lineM += r.lineMisses;
  }
  return {
    images: rows.length,
    looseCER: lN ? Number((lD / lN).toFixed(4)) : 0,
    strictCER: sN ? Number((sD / sN).toFixed(4)) : 0,
    lineMissRate: lineN ? Number((lineM / lineN).toFixed(4)) : 0,
    lines: lineN,
    missedLines: lineM,
  };
}

const byCat = {};
for (const r of cases) (byCat[r.category] ||= []).push(r);
const summary = {
  overall: aggregate(cases),
  byCategory: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, aggregate(v)])),
  worst: [...cases].sort((a, b) => b.looseCER - a.looseCER).slice(0, 12).map((r) => ({
    file: r.file, category: r.category, looseCER: Number(r.looseCER.toFixed(3)),
    strictCER: Number(r.strictCER.toFixed(3)), lineMisses: r.lineMisses, missedLines: r.missedLines,
    actual: r.actual.slice(0, 240),
  })),
};
await writeFile(outPath, JSON.stringify({ summary, cases }, null, 2));
console.log("SUMMARY", JSON.stringify(summary, null, 2));
