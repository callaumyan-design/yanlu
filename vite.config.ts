import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

const strictCsp = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src 'none'",
  "form-action 'self'",
].join("; ");

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "yanlu-csp",
      transformIndexHtml(html, ctx) {
        const csp = ctx.server
          ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self' ws:; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'"
          : strictCsp;
        return html.replace(
          "<!--CSP-->",
          `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
        );
      },
    },
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
  },
  server: {
    host: "127.0.0.1",
    port: 43123,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 43124,
    strictPort: true,
  },
  test: {
    environment: "node",
    fileParallelism: false,
    testTimeout: 180000,
    hookTimeout: 180000,
    server: {
      deps: {
        external: ["onnxruntime-node", "sharp"],
      },
    },
  },
});
