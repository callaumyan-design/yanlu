import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const dir = path.resolve("public/models");
const text = await readFile(path.join(dir, "SHA256SUMS"), "utf8");
let failed = false;
for (const line of text.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  const [expected, name] = trimmed.split(/\s+/);
  const data = await readFile(path.join(dir, name));
  const actual = createHash("sha256").update(data).digest("hex");
  const ok = actual === expected;
  console.log(`${ok ? "OK" : "FAIL"}  ${name}`);
  if (!ok) {
    console.log(`  expected ${expected}`);
    console.log(`  actual   ${actual}`);
    failed = true;
  }
}
if (failed) process.exit(1);
