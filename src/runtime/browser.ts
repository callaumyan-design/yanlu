import * as ort from "onnxruntime-web/wasm";
import { parseDict } from "@/ocr/dict";
import type { OcrDeps, OcrProgress, Runner } from "@/ocr/types";

let configured = false;

export function configureRuntime(): void {
  if (configured) return;
  configured = true;
  // Leave wasmPaths unset so Vite emits a same-origin URL for the bundled wasm.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  ort.env.wasm.proxy = false;
  ort.env.logLevel = "error";
}

function wrap(session: ort.InferenceSession): Runner {
  return {
    async run(data, dims) {
      const tensor = new ort.Tensor("float32", data, dims);
      const output = await session.run({ x: tensor });
      const name = session.outputNames[0];
      const value = output[name];
      const raw = value.data as Float32Array;
      const copied = raw instanceof Float32Array ? new Float32Array(raw) : Float32Array.from(raw as ArrayLike<number>);
      return { data: copied, dims: [...value.dims] };
    },
  };
}

async function loadBuffer(name: string): Promise<ArrayBuffer> {
  const response = await fetch(new URL(`models/${name}`, window.location.href));
  if (!response.ok) throw new Error(`模型文件缺失：${name}`);
  return response.arrayBuffer();
}

export async function createBrowserDeps(onProgress?: (progress: OcrProgress) => void): Promise<OcrDeps> {
  configureRuntime();
  onProgress?.({ ratio: 0.04, message: "正在加载识别模型" });
  const [detBuffer, clsBuffer, recBuffer, dictResponse] = await Promise.all([
    loadBuffer("ch_PP-OCRv5_det_mobile.onnx"),
    loadBuffer("ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx"),
    loadBuffer("ch_PP-OCRv5_rec_mobile.onnx"),
    fetch(new URL("models/ppocrv5_dict.txt", window.location.href)),
  ]);
  if (!dictResponse.ok) throw new Error("字典文件缺失");
  onProgress?.({ ratio: 0.1, message: "正在初始化推理引擎" });
  const options: ort.InferenceSession.SessionOptions = {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  };
  const [det, cls, rec] = await Promise.all([
    ort.InferenceSession.create(detBuffer, options),
    ort.InferenceSession.create(clsBuffer, options),
    ort.InferenceSession.create(recBuffer, options),
  ]);
  return {
    det: wrap(det),
    cls: wrap(cls),
    rec: wrap(rec),
    dict: parseDict(await dictResponse.text()),
  };
}
