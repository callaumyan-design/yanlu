import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

const repo = path.resolve(process.argv[2] || ".");
const outPath = path.resolve(process.argv[3] || "/tmp/holdout/pred.json");
const labels = JSON.parse(await readFile(path.resolve("tests/holdout/labels.json"), "utf8"));
const imageDir = labels.image_dir;
const { rgbaToRgb } = await import(pathToFileURL(path.join(repo, "src/ocr/image.ts")).href);
const { recognizeImage } = await import(pathToFileURL(path.join(repo, "src/ocr/pipeline.ts")).href);
const { createNodeDeps } = await import(pathToFileURL(path.join(repo, "src/runtime/node.ts")).href);
const deps = await createNodeDeps(path.join(repo, "public/models"));
const cases = [];
const started = Date.now();
let rssMax = 0;
for (const item of labels.items) {
  const t0 = Date.now();
  const decoded = await sharp(path.join(imageDir, item.file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const image = rgbaToRgb({ width: decoded.info.width, height: decoded.info.height, data: decoded.data });
  const result = await recognizeImage(image, deps);
  const rss = process.memoryUsage().rss;
  if (rss > rssMax) rssMax = rss;
  cases.push({
    id: item.id,
    file: item.file,
    source: item.source,
    ms: Date.now() - t0,
    text: result.text,
    boxes: result.boxes.length,
  });
  console.log(`${item.file} ${Date.now() - t0}ms boxes=${result.boxes.length}`);
}
await writeFile(
  outPath,
  JSON.stringify({ repo, wallMs: Date.now() - started, rssMax, cases }, null, 2),
);
console.log("wrote", outPath, "rssMax", rssMax);
