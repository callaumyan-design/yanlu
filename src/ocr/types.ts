export interface Point {
  x: number;
  y: number;
}

export interface RgbImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface Runner {
  run(
    data: Float32Array,
    dims: number[],
  ): Promise<{ data: Float32Array; dims: number[] }>;
}

export interface OcrDeps {
  det: Runner;
  cls: Runner;
  rec: Runner;
  /** Index 0 is the CTC blank. The final entry is the ASCII space. */
  dict: string[];
}

export interface OcrBox {
  text: string;
  score: number;
  points: Point[];
}

export interface OcrResult {
  text: string;
  boxes: OcrBox[];
  meanScore: number;
}

export interface OcrProgress {
  ratio: number;
  message: string;
}
