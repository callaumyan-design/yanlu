import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { levenshtein, normalizeForAccuracy } from "../src/ocr/accuracy.ts";
import { rgbaToRgb } from "../src/ocr/image.ts";
import { recognizeImage } from "../src/ocr/pipeline.ts";
import { createNodeDeps } from "../src/runtime/node.ts";

const root = process.env.YANLU_REALTEST || "/workspace/yanlu-realtest";
const labels = JSON.parse(await readFile(path.join(root, "labels.json"), "utf8"));
const only = new Set((process.argv[2] || "").split(",").filter(Boolean));
const configs = JSON.parse(process.argv[3] || "[{}]");
const deps = await createNodeDeps(process.env.YANLU_MODELS || path.resolve("public/models"));

function loose(s) {
  return normalizeForAccuracy(s);
}
function strict(s) {
  return s.normalize("NFKC");
}
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
    const n2 = Math.min(o.length, Math.ceil(n * 1.3));
    for (let i = 0; i <= o.length - n2; i += Math.max(1, Math.floor(n / 3))) {
      const d = levenshtein(g, o.slice(i, i + n2)) / n;
      if (d < best) best = d;
      if (best <= 0.3) return true;
    }
  }
  return best <= 0.3;
}

const items = labels.items.filter((item) => !only.size || only.has(item.file));
const decoded = [];
for (const item of items) {
  const file = path.join(root, "images", item.file);
  const raw = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  decoded.push({
    item,
    image: rgbaToRgb({ width: raw.info.width, height: raw.info.height, data: raw.data }),
  });
}

function aggregate(rows) {
  let lD = 0, lN = 0, sD = 0, sN = 0, lineN = 0, lineM = 0, ms = 0;
  const by = {};
  for (const row of rows) {
    lD += row.looseCER * row.lineLooseN;
    lN += row.lineLooseN;
    sD += row.strictCER * row.lineStrictN;
    sN += row.lineStrictN;
    lineN += row.lineCount;
    lineM += row.lineMisses;
    ms += row.ms;
    const bag = (by[row.category] ||= { lD: 0, lN: 0, lineN: 0, lineM: 0, images: 0 });
    bag.lD += row.looseCER * row.lineLooseN;
    bag.lN += row.lineLooseN;
    bag.lineN += row.lineCount;
    bag.lineM += row.lineMisses;
    bag.images++;
  }
  const cats = {};
  for (const [key, bag] of Object.entries(by)) {
    cats[key] = {
      images: bag.images,
      looseCER: bag.lN ? Number((bag.lD / bag.lN).toFixed(4)) : 0,
      lineMissRate: bag.lineN ? Number((bag.lineM / bag.lineN).toFixed(4)) : 0,
      missed: bag.lineM,
      lines: bag.lineN,
    };
  }
  return {
    images: rows.length,
    looseCER: lN ? Number((lD / lN).toFixed(4)) : 0,
    strictCER: sN ? Number((sD / sN).toFixed(4)) : 0,
    lineMissRate: lineN ? Number((lineM / lineN).toFixed(4)) : 0,
    lines: lineN,
    missedLines: lineM,
    ms,
    cats,
  };
}

for (const config of configs) {
  const rows = [];
  let sideways = 0;
  const t0 = Date.now();
  for (const { item, image } of decoded) {
    const trace = {};
    const started = Date.now();
    const result = await recognizeImage(image, deps, undefined, { ...config, trace });
    if (trace.sideways) sideways++;
    const lines = item.lines.filter((line) => loose(line).length >= 2);
    const missed = lines.filter((line) => !lineHit(line, result.text));
    let lineLooseD = 0, lineLooseN = 0, lineStrictD = 0, lineStrictN = 0;
    const actL = loose(result.text);
    const actS = strict(result.text);
    for (const line of lines) {
      const gL = loose(line);
      const gS = strict(line);
      lineLooseD += bestWindowCER(gL, actL) * gL.length;
      lineLooseN += gL.length;
      lineStrictD += bestWindowCER(gS, actS) * gS.length;
      lineStrictN += gS.length;
    }
    rows.push({
      file: item.file,
      category: item.category,
      looseCER: lineLooseN ? lineLooseD / lineLooseN : 0,
      strictCER: lineStrictN ? lineStrictD / lineStrictN : 0,
      lineLooseN,
      lineStrictN,
      lineCount: lines.length,
      lineMisses: missed.length,
      missedLines: missed,
      actual: result.text,
      ms: Date.now() - started,
      rotation: trace.rotation ?? 0,
    });
  }
  const summary = aggregate(rows);
  summary.wallMs = Date.now() - t0;
  summary.sidewaysPages = sideways;
  console.log("CONFIG", JSON.stringify(config));
  console.log("SUMMARY", JSON.stringify(summary));
  const interesting = rows.filter((row) => row.lineMisses || row.looseCER > 0.02);
  for (const row of interesting) {
    console.log(
      `  ${row.file} rot=${row.rotation} loose=${row.looseCER.toFixed(3)} miss=${row.lineMisses} ${JSON.stringify(row.missedLines).slice(0, 180)}`,
    );
  }
}

const synthDir = path.resolve("tests/regression");
if (process.env.YANLU_SYNTH === "1") {
  const expected = JSON.parse(await readFile(path.join(synthDir, "expected.json"), "utf8"));
  for (const config of configs) {
    let chars = 0;
    let dist = 0;
    const bad = [];
    const t0 = Date.now();
    for (const item of expected) {
      const raw = await sharp(path.join(synthDir, item.file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const image = rgbaToRgb({ width: raw.info.width, height: raw.info.height, data: raw.data });
      const result = await recognizeImage(image, deps, undefined, config);
      const g = loose(item.text);
      const a = loose(result.text);
      const d = levenshtein(g, a);
      chars += g.length;
      dist += d;
      if (d) bad.push(`${item.file} d=${d} ${a.slice(0, 80)}`);
    }
    console.log("SYNTH", JSON.stringify(config), "looseCER", (dist / chars).toFixed(4), "ms", Date.now() - t0);
    for (const line of bad) console.log("  ", line);
  }
}
