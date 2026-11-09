import { readFile } from "node:fs/promises";
import path from "node:path";
import * as ort from "onnxruntime-node";
import { parseDict } from "@/ocr/dict";
import type { OcrDeps, Runner } from "@/ocr/types";

function wrap(session: ort.InferenceSession): Runner {
  return {
    async run(data, dims) {
      const tensor = new ort.Tensor("float32", data, dims);
      const output = await session.run({ x: tensor });
      const name = session.outputNames[0];
      const value = output[name];
      const raw = value.data as Float32Array;
      const copied = raw instanceof Float32Array ? new Float32Array(raw) : Float32Array.from(raw);
      return { data: copied, dims: [...value.dims] };
    },
  };
}

export async function createNodeDeps(modelDir = path.resolve("public/models")): Promise<OcrDeps> {
  const options: ort.InferenceSession.SessionOptions = {
    executionProviders: ["cpu"],
    intraOpNumThreads: 2,
    interOpNumThreads: 1,
    graphOptimizationLevel: "all",
  };
  const [det, cls, rec, dictText] = await Promise.all([
    ort.InferenceSession.create(path.join(modelDir, "ch_PP-OCRv5_det_mobile.onnx"), options),
    ort.InferenceSession.create(
      path.join(modelDir, "ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx"),
      options,
    ),
    ort.InferenceSession.create(path.join(modelDir, "ch_PP-OCRv5_rec_mobile.onnx"), options),
    readFile(path.join(modelDir, "ppocrv5_dict.txt"), "utf8"),
  ]);
  return { det: wrap(det), cls: wrap(cls), rec: wrap(rec), dict: parseDict(dictText) };
}
