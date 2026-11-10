import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const dest = process.argv[2] || "/workspace/yanlu-realtest/images";
const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
await mkdir(dest, { recursive: true });
for (const item of manifest.items) {
  if (!item.url || !item.url.startsWith("http")) {
    console.log("skip", item.file, item.url);
    continue;
  }
  const out = path.join(dest, item.file);
  const res = await fetch(item.url, { headers: { "User-Agent": "yanlu-realtest/1.0" } });
  if (!res.ok) {
    console.log("FAIL", item.file, res.status);
    continue;
  }
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
  console.log("ok", item.file);
}
