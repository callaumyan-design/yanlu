import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

async function walk(dir, root = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full, root)));
    else if (entry.name !== "sw.js") files.push(path.relative(root, full).split(path.sep).join("/"));
  }
  return files;
}

const dist = path.resolve("dist");
const files = await walk(dist);
const assets = files.map((file) => `./${file}`);
const source = `const CACHE = "yanlu-v1";
const ASSETS = ${JSON.stringify(assets, null, 2)};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      for (const asset of ASSETS) {
        const response = await fetch(asset);
        if (!response.ok) throw new Error("cache " + asset);
        await cache.put(asset, response);
      }
    }).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    event.respondWith(Promise.reject(new Error("blocked")));
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      });
    }),
  );
});
`;
await writeFile(path.join(dist, "sw.js"), source);
const info = await stat(path.join(dist, "sw.js"));
console.log(`wrote sw.js (${assets.length} assets, ${info.size} bytes)`);
