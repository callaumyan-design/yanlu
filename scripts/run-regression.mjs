import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { characterAccuracy, levenshtein, normalizeForAccuracy, strictCharacterAccuracy } from "../src/ocr/accuracy.ts";
import { rgbaToRgb } from "../src/ocr/image.ts";
import { recognizeImage } from "../src/ocr/pipeline.ts";
import { createNodeDeps } from "../src/runtime/node.ts";

const root = path.resolve("tests/regression");
const outPath = process.argv[2] || "regression-report.json";
const expected = JSON.parse(await readFile(path.join(root, "expected.json"), "utf8"));
const deps = await createNodeDeps(path.resolve("public/models"));

let looseDist = 0, looseLen = 0, strictDist = 0, strictLen = 0;
const cases = [];
for (const item of expected) {
  const decoded = await sharp(path.join(root, item.file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const image = rgbaToRgb({ width: decoded.info.width, height: decoded.info.height, data: decoded.data });
  const result = await recognizeImage(image, deps);
  const expN = normalizeForAccuracy(item.text);
  const actN = normalizeForAccuracy(result.text);
  const expS = item.text.normalize("NFKC");
  const actS = result.text.normalize("NFKC");
  const dLoose = levenshtein(expN, actN);
  const dStrict = levenshtein(expS, actS);
  looseDist += dLoose;
  looseLen += expN.length;
  strictDist += dStrict;
  strictLen += expS.length;
  cases.push({
    file: item.file,
    tags: item.tags,
    expected: item.text,
    actual: result.text,
    looseAccuracy: Number(characterAccuracy(item.text, result.text).toFixed(4)),
    strictAccuracy: Number(strictCharacterAccuracy(item.text, result.text).toFixed(4)),
    looseCER: expN.length ? Number((dLoose / expN.length).toFixed(4)) : 0,
    strictCER: expS.length ? Number((dStrict / expS.length).toFixed(4)) : 0,
    boxes: result.boxes.length,
  });
  const mark = dLoose === 0 && dStrict === 0 ? "OK" : dLoose === 0 ? "SP" : "ER";
  console.log(`${mark} ${item.file} loose=${(1-dLoose/Math.max(expN.length,1)).toFixed(3)} strict=${(1-dStrict/Math.max(expS.length,1)).toFixed(3)}`);
  if (mark !== "OK") {
    console.log("  EXP:", JSON.stringify(item.text));
    console.log("  ACT:", JSON.stringify(result.text));
  }
}

const summary = {
  images: cases.length,
  looseCER: Number((looseDist / looseLen).toFixed(4)),
  strictCER: Number((strictDist / strictLen).toFixed(4)),
  looseAccuracy: Number((1 - looseDist / looseLen).toFixed(4)),
  strictAccuracy: Number((1 - strictDist / strictLen).toFixed(4)),
  cases,
};
await writeFile(outPath, JSON.stringify(summary, null, 2));
console.log("SUMMARY", { images: summary.images, looseCER: summary.looseCER, strictCER: summary.strictCER, outPath });
