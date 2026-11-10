import { Camera, Copy, Download, ImagePlus, Loader2, ScanText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { fileToRgba, recognizeRgba } from "@/ocr/client";
import type { OcrBox } from "@/ocr/types";

type Phase = "idle" | "busy" | "done" | "error";

function drawBoxes(
  canvas: HTMLCanvasElement,
  boxes: OcrBox[],
  naturalWidth: number,
  naturalHeight: number,
) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx || rect.width === 0 || naturalWidth === 0) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const sx = rect.width / naturalWidth;
  const sy = rect.height / naturalHeight;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(157, 44, 44, 0.92)";
  ctx.fillStyle = "rgba(157, 44, 44, 0.12)";
  for (const box of boxes) {
    const pts = box.points;
    if (pts.length < 4) continue;
    ctx.beginPath();
    ctx.moveTo(pts[0].x * sx, pts[0].y * sy);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * sx, pts[i].y * sy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

export function App() {
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef(0);
  const dragDepth = useRef(0);
  const runFileRef = useRef<(file: Blob) => void>(() => {});

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [boxes, setBoxes] = useState<OcrBox[]>([]);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("选择一张图片，或把截图粘贴到这里。");
  const [ratio, setRatio] = useState(0);
  const [showBoxes, setShowBoxes] = useState(true);
  const [copied, setCopied] = useState(false);
  const [meanScore, setMeanScore] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (!file) return;
          event.preventDefault();
          runFileRef.current(file);
          return;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !showBoxes || !previewUrl) return;
    drawBoxes(canvas, boxes, natural.width, natural.height);
    const onResize = () => drawBoxes(canvas, boxes, natural.width, natural.height);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [boxes, showBoxes, natural, previewUrl]);

  async function runFile(file: Blob) {
    const id = ++requestRef.current;
    setPhase("busy");
    setRatio(0.02);
    setMessage("正在读取图片");
    setCopied(false);
    setBoxes([]);
    setText("");
    try {
      const loaded = await fileToRgba(file);
      if (id !== requestRef.current) {
        URL.revokeObjectURL(loaded.previewUrl);
        return;
      }
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return loaded.previewUrl;
      });
      setNatural({ width: loaded.image.width, height: loaded.image.height });
      const result = await recognizeRgba(loaded.image, (progress) => {
        if (id !== requestRef.current) return;
        setRatio(progress.ratio);
        setMessage(progress.message);
      });
      if (id !== requestRef.current) return;
      setText(result.text);
      setBoxes(result.boxes);
      setMeanScore(result.meanScore);
      setPhase("done");
      setRatio(1);
      setMessage(
        result.text
          ? `识别完成，共 ${result.text.replace(/\s/g, "").length} 个字符`
          : "没有识别到文字。换一张更清晰的图片试试。",
      );
    } catch (error) {
      if (id !== requestRef.current) return;
      setPhase("error");
      setMessage(error instanceof Error ? error.message : "识别失败");
    }
  }

  runFileRef.current = (file) => {
    void runFile(file);
  };

  function onFiles(list: FileList | null) {
    const file = list?.[0];
    if (file) void runFile(file);
  }

  async function copyText() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function exportText() {
    if (!text) return;
    const blob = new Blob([`\uFEFF${text}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "砚录-识别结果.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  const busy = phase === "busy";

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6">
      <header className="flex items-start justify-between gap-4 py-2">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-seal text-lg text-white shadow-sm">
            砚
          </div>
          <div>
            <h1 className="text-2xl tracking-tight">砚录</h1>
            <p className="text-sm text-muted">图片和文字只留在这台设备上</p>
          </div>
        </div>
        <p className="hidden text-right text-xs leading-5 text-muted sm:block">
          PP-OCRv5
          <br />
          简体中文 / English
        </p>
      </header>

      <main className="mt-4 grid flex-1 gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <section
          className={`flex min-h-[280px] flex-col rounded-3xl border bg-card p-4 shadow-[0_20px_50px_-36px_rgba(28,25,21,0.7)] ${
            dragging ? "border-seal" : "border-line"
          }`}
          onDragEnter={(event) => {
            event.preventDefault();
            dragDepth.current += 1;
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => {
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            dragDepth.current = 0;
            setDragging(false);
            onFiles(event.dataTransfer.files);
          }}
        >
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="seal" disabled={busy} onClick={() => galleryRef.current?.click()}>
              <ImagePlus size={18} />
              选择图片
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => cameraRef.current?.click()}>
              <Camera size={18} />
              拍照
            </Button>
            <input
              ref={galleryRef}
              className="hidden"
              type="file"
              accept="image/*"
              onChange={(event) => {
                onFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <input
              ref={cameraRef}
              className="hidden"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => {
                onFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>

          <div className="relative mt-4 grid flex-1 place-items-center overflow-hidden rounded-2xl bg-[#f7f2e8]">
            {previewUrl ? (
              <div className="relative max-h-[68vh] max-w-full">
                <img
                  src={previewUrl}
                  alt="待识别的图片"
                  className="max-h-[68vh] max-w-full object-contain"
                />
                {showBoxes && (
                  <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
                )}
              </div>
            ) : (
              <div className="px-6 py-16 text-center">
                <ScanText className="mx-auto text-seal" size={36} />
                <p className="mt-4 text-lg">把图片交给砚录</p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted">
                  从相册选择、用相机拍照，或把文件拖进这个窗口。在电脑上也可以直接粘贴截图。
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-muted">
              <Switch checked={showBoxes} onCheckedChange={setShowBoxes} aria-label="显示检测框" />
              显示检测框
            </label>
            <p className="text-xs text-muted">支持 JPG、PNG、WebP</p>
          </div>
        </section>

        <section className="flex min-h-[320px] flex-col rounded-3xl border border-line bg-card p-4 shadow-[0_20px_50px_-36px_rgba(28,25,21,0.7)]">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-medium">识别结果</h2>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={!text || busy} onClick={() => void copyText()}>
                <Copy size={16} />
                {copied ? "已复制" : "复制"}
              </Button>
              <Button type="button" variant="default" disabled={!text || busy} onClick={exportText}>
                <Download size={16} />
                导出 TXT
              </Button>
            </div>
          </div>

          <div className="mt-3" aria-live="polite">
            <div className="mb-1 flex items-center justify-between text-sm text-muted">
              <span className="inline-flex items-center gap-2">
                {busy && <Loader2 className="animate-spin" size={14} />}
                {message}
              </span>
              {phase === "done" && meanScore > 0 && (
                <span title="已检出片段的平均置信度，不是整页准确率。没被检出的文字不会拉低这个数字。">
                  片段置信度 {Math.round(meanScore * 100)}%
                </span>
              )}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#efe6d6]">
              <div
                className="h-full rounded-full bg-seal transition-[width] duration-300"
                style={{ width: `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%` }}
              />
            </div>
          </div>

          <label className="mt-4 flex min-h-0 flex-1 flex-col">
            <span className="sr-only">识别出的文字，可以修改</span>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={busy ? "正在识别…" : "识别出的文字会显示在这里，可以直接修改后再复制。"}
              className="min-h-64 w-full flex-1 resize-y rounded-2xl border border-line bg-[#fffaf3] px-4 py-3 text-base leading-7 outline-none focus-visible:ring-2 focus-visible:ring-seal/60 lg:min-h-[420px]"
              spellCheck={false}
            />
          </label>
          {phase === "error" && (
            <p className="mt-3 text-sm text-seal">识别没有完成。请确认图片可以打开，然后重试。</p>
          )}
        </section>
      </main>

      <footer className="mt-5 flex flex-col gap-1 text-xs leading-5 text-muted sm:flex-row sm:justify-between">
        <p>识别在本地完成。不会上传图片，也不会发送统计数据。</p>
        <p>手机可添加到主屏幕，离线后仍可使用。</p>
      </footer>
    </div>
  );
}
