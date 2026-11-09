import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { characterAccuracy, normalizeForAccuracy, strictCharacterAccuracy } from "@/ocr/accuracy";
import { rgbaToRgb } from "@/ocr/image";
import { recognizeImage } from "@/ocr/pipeline";
import { createNodeDeps } from "@/runtime/node";

const root = path.resolve("tests/fixtures");
const modelDir = path.resolve("public/models");

async function verifyModels() {
  const text = await readFile(path.join(modelDir, "SHA256SUMS"), "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [expected, name] = trimmed.split(/\s+/);
    const data = await readFile(path.join(modelDir, name));
    const actual = createHash("sha256").update(data).digest("hex");
    expect(actual, name).toBe(expected);
  }
}

describe("offline PP-OCRv5", () => {
  it("recognizes Chinese and English fixtures above the accuracy bar", async () => {
    await verifyModels();
    const deps = await createNodeDeps(modelDir);
    const expected = JSON.parse(await readFile(path.join(root, "expected.json"), "utf8")) as {
      file: string;
      text: string;
      minAccuracy: number;
    }[];
    const report = [];
    let weightedHit = 0;
    let strictHit = 0;
    let weightedLen = 0;
    let strictLen = 0;
    for (const item of expected) {
      const decoded = await sharp(path.join(root, item.file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const image = rgbaToRgb({
        width: decoded.info.width,
        height: decoded.info.height,
        data: decoded.data,
      });
      const result = await recognizeImage(image, deps);
      const accuracy = characterAccuracy(item.text, result.text);
      const strict = strictCharacterAccuracy(item.text, result.text);
      const chars = normalizeForAccuracy(item.text).length;
      weightedHit += accuracy * chars;
      weightedLen += chars;
      const strictChars = item.text.normalize("NFKC").length;
      strictHit += strict * strictChars;
      strictLen += strictChars;
      report.push({
        file: item.file,
        accuracy: Number(accuracy.toFixed(4)),
        strictAccuracy: Number(strict.toFixed(4)),
        minAccuracy: item.minAccuracy,
        expected: item.text,
        actual: result.text,
        meanScore: Number(result.meanScore.toFixed(4)),
      });
      expect(accuracy, `${item.file}\nEXPECTED:\n${item.text}\nACTUAL:\n${result.text}`).toBeGreaterThanOrEqual(
        item.minAccuracy,
      );
    }
    const mean = weightedHit / weightedLen;
    const summary = {
      meanCharacterAccuracy: Number(mean.toFixed(4)),
      meanStrictCharacterAccuracy: Number((strictHit / strictLen).toFixed(4)),
      cases: report,
    };
    await writeFile(path.resolve("accuracy-report.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    expect(mean).toBeGreaterThanOrEqual(0.97);
  });
});

describe("source stays offline", () => {
  it("does not reference remote hosts in app source", async () => {
    const roots = ["src", "electron", "index.html"].map((item) => path.resolve(item));
    const files: string[] = [];
    for (const item of roots) {
      try {
        const info = await readdir(item, { withFileTypes: true }).catch(() => null);
        if (!info) {
          files.push(item);
          continue;
        }
        const stack = info.map((entry) => path.join(item, entry.name));
        while (stack.length) {
          const current = stack.pop() as string;
          const stat = await readdir(current, { withFileTypes: true }).catch(() => null);
          if (!stat) {
            files.push(current);
            continue;
          }
          for (const entry of stat) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) stack.push(full);
            else files.push(full);
          }
        }
      } catch {
        files.push(item);
      }
    }
    const banned = /https?:\/\/(?!127\.0\.0\.1|localhost)/i;
    for (const file of files) {
      if (!/\.(ts|tsx|js|cjs|mjs|html|css|svg)$/.test(file)) continue;
      const text = await readFile(file, "utf8");
      expect(text, file).not.toMatch(banned);
    }
  });
});
