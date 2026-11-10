# Real-world OCR eval (images not stored in git)

Images stay on the evaluation machine (e.g. `/workspace/yanlu-realtest/images`). This folder has:

- `manifest.json` — source URLs, licenses, and categories
- `labels.json` — line-level ground truth (self-labeled unless noted)

Download with the script under `/workspace/yanlu-realtest/scripts/download.py` (kept outside the repo so leftover binaries are not committed). Run the Yanlu harness from the repo:

```bash
npx tsx scripts/eval-realtest.mjs /tmp/yanlu-real-eval.json
```
