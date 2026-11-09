import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

mkdirSync("release", { recursive: true });
const out = path.resolve("release/yanlu-pwa.zip");
const result = spawnSync("zip", ["-r", "-q", out, "."], { cwd: path.resolve("dist"), stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(out);
