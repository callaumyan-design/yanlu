import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { chromium } from "playwright";

const port = 43124;
const base = `http://127.0.0.1:${port}/`;
const fixture = path.resolve("tests/fixtures/mixed.png");

function startPreview() {
  const child = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    stdio: "ignore",
    cwd: process.cwd(),
    detached: true,
  });
  return { child };
}

async function waitForServer(child) {
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) throw new Error("preview exited early");
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await delay(200);
  }
  throw new Error("preview server did not start");
}

const preview = startPreview();
const external = [];
const requests = [];
try {
  await waitForServer(preview.child);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("request", (request) => {
    const url = new URL(request.url());
    requests.push(url.href);
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.protocol === "blob:" || url.protocol === "data:";
    if (!local) external.push(url.href);
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (!url.startsWith("blob:") && !url.startsWith("data:")) {
      const parsed = new URL(url);
      if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") external.push(url);
    }
  });
  await page.goto(base);
  await page.locator("input[type=file]").first().setInputFiles(fixture);
  await page.waitForFunction(
    () => document.querySelector("textarea")?.value.includes("砚录可以识别"),
    null,
    { timeout: 120000 },
  );
  const text = await page.locator("textarea").inputValue();
  if (!text.includes("简体中文")) throw new Error(`unexpected OCR text: ${text}`);
  await page.getByRole("button", { name: "复制" }).click();
  await browser.close();
  if (external.length) {
    console.error("external requests:", external);
    process.exitCode = 1;
  } else if (!requests.some((url) => url.includes(".wasm")) || !requests.some((url) => url.includes(".onnx"))) {
    console.error("expected local wasm and model requests, saw:", requests);
    process.exitCode = 1;
  } else {
    console.log(`network ok: ${requests.length} same-origin requests, 0 external`);
    console.log(requests.map((url) => url.replace(base, "/")).join("\n"));
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  try {
    process.kill(-preview.child.pid, "SIGTERM");
  } catch {
    preview.child.kill("SIGTERM");
  }
}
