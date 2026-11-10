# Yanlu OCR optimization report

Source tip imported from the attached bundle `1e515a79bee3ff1379687c95094f7f47c8703c82` and replayed onto GitHub `main` (`b770765`) without rewriting `main`. File trees match that tip. New commits use `callaumyan-design <callaumyan-design@users.noreply.github.com>`.

Recognition stays on-device. No new network calls, telemetry, or remote models. CSP remains `connect-src 'self'`. Bundled model checksums are unchanged (`public/models/SHA256SUMS`).

## Label and matcher audit

The 46-image set is entirely self-labeled (`labels.json`). 32 items are marked complete and 14 partial. 22 other downloaded files are unlabeled and were not used for tuning. Handwriting glyphs of length 1 are excluded by the harness (`loose` length < 2), so that image contributes 0 lines. Do not read a 0 there as solved handwriting.

The published line-miss rule in `scripts/eval-realtest.mjs` is not the same function as window CER. Rescoring the saved AFTER text with `best_window_cer > 0.3` gives 29 misses; the saved file reports 31. The coarse stride (`n/5`) also disagrees with an exact window on 7 lines and is pessimistic (for example the long product sentence in `paddle_11.jpg`, stride CER 0.205 vs exact 0.023). Scores below use the original harness so they stay comparable. They are not a full-page transcription score.

Checked against the pixels, not the previous crop notes:

- `rapid_vertical.png` third column begins with 已, not the labeled 巳. The label is wrong for that one character. 參, 見, and 而 are really there.
- `paddle_1.jpg` has a single thin vertical stroke between 大学 and 东园. The label writes `——`.
- `paddle_medal_table.png` numbers are a bag of tokens, and digits shorter than 2 characters are dropped from the metric. A number that appears anywhere on the page counts as a hit.
- `derived_lab_left.jpg` still contains `0.83--1.91`; the model writes `mmo1` for `mmol`. That is a character error. The saved "miss" is the stride matcher failing to land on it.
- `paddle_en_img623.jpg` really does miss the stylized HARANA sign. The 99% score was the confidence of the URL fragment, not page coverage.

## Same-sample results

46 images, 416 scored lines. Baseline is the imported tip, re-run here (it matches the handoff: loose 0.0389, strict 0.0954, line miss 0.0745).

| | loose CER | strict CER | line miss |
| --- | ---: | ---: | ---: |
| Baseline (imported tip) | 0.0389 | 0.0954 | 0.0745 (31) |
| This branch | 0.0344 | 0.0931 | 0.0337 (14) |
| Synthetic 22, before and after | 0.0008 | 0.0405 | long_line still drops 片 |

| category | baseline loose / miss | candidate loose / miss |
| --- | --- | --- |
| document (14, 255 lines) | 0.0257 / 0.0824 | 0.0192 / 0.0235 |
| product_label | 0.0130 / 0 | 0.0130 / 0 |
| ticket | 0.0103 / 0.0714 | 0.0103 / 0.0714 |
| receipt | 0.0337 / 0 | 0.0337 / 0 |
| street_sign | 0.1388 / 0.2143 | 0.1388 / 0.2143 |
| rotated | 0 / 0 | 0 / 0 |
| vertical | 0.1509 / 0.4000 | 0.0566 / 0 |
| screenshot | 0.0654 / 0 | 0.0654 / 0 |
| book | 0.1000 / 0.1429 | 0.1000 / 0.1429 |
| scan | 0.0215 / 0 | 0.0215 / 0 |
| handwriting | n/a (0 scored lines) | n/a |

Node wall time for the 46 images on this machine: about 40s before, about 37s after. Synthetic strict CER is unchanged, including the reconstructed `每 5 小时` and `高级功能` lines. `stress_gao_xiao.png` is still exact. The original user screenshot is not on this machine and was not rechecked.

Vertical text is back to separate columns, right to left:

```
有評是是非非之士師也
是非不得問之人要取之
已取之時不參一人見而
```

The plaque again reads `华南农业大学—东园` on its own line (one dash, not the labeled two). The medal table is read in row order, including 48, 36, 112, and the other numbers that were previously missed. Rank 7 before 韩国 is still absent; other 7s on the page hide that from the bag-of-tokens metric.

## What changed, and the cause

The detector's median box aspect was below 1 on narrow digits and on upright vertical columns, so the whole page was rotated 90° or 270°. Tall crops are then rotated back for recognition, but square digit cells are not, so the medal numbers were read sideways. Re-detecting the vertical page after that rotation also split the third column (`參`→`参`, `見而`→`日見耐`). Per-crop rotation already handles a genuinely sideways photo: the 9 rotated images stay at loose CER 0 with page rotation removed, and `rot90.png` / `rot270.png` stay above their 0.97 fixture bar.

Neighboring vertical columns share a vertical center, so line grouping was gluing them into one row. Columns now stack only when they overlap in x, and a page of columns is ordered right to left.

The confidence label is now `片段置信度`. It is the average over detected fragments. Missed text does not lower it. HARANA can still show a high number.

Service worker cache is `yanlu-v4`.

## Rejected experiments

- Unclip 1.75 → 1.6, with page rotation already off. Receipt loose CER returned to 0.0225, but street signs 0.1388 → 0.1459, vertical 0.0566 → 0.0755, and screenshots gained a line miss (14 → 15). Aggregate loose 0.0337 was not accepted over those category regressions.
- Splitting a long recognition crop. A shorter window does contain `片` in `long_line.png`, but the overlap stitch duplicates the tail. The full-line reading is kept. Loose CER on the synthetic 22 stays 0.0008 with `片` still missing.
- PP-OCRv5 server recognition (Apache-2.0 ONNX, 81 MiB, input `x`, height 48). On 11 hard images it took 582s (~53s each). Receipts improved (loose 0.0337 → 0.0037) and the seal company name partly improved, but the book page went 0.100 → 0.564 and vertical 0.0566 → 0.1132. HARANA did not improve. Not shipped, including as an optional mobile mode.
- PP-OCRv5 server detection (85 MiB). About 2.5–3.5s per image here. The medal table is also read correctly by the mobile detector once the page is not rotated. HARANA still misses the wordmark (it found `1966` and the footer URL). Not shipped. Both files are over the 25 MiB asset cap and were not bundled.

## Holdout

No official ground truth for a fresh image set was in the bundle. The 22 unlabeled downloads were not used to choose the change. After the code was frozen, two of them were run once:

- `paddle_en_1.png` is a business card with the dataset's own boxes drawn on the right. The card fields are read, and so are the duplicate annotation strings. `Template.net` gains a space.
- `paddle_wildreceipt_2769.jpeg` has burned-in field labels. The receipt body is mostly present. `Chk Faj Bowl` becomes `Chk Faj BowT`, `Small Soda` becomes `Smal11 Soda`, and the tax label is garbled. Those overlays are why it was excluded from the 46.

That is not an untouched official-GT score.

## Size, startup, memory

Production zip `release/yanlu-pwa.zip` is 23,609,811 bytes (22.52 MiB). SHA-256 `9ec80380a0e2fd482c19a461ddac6d4aaeca62e33baa99c870cb866d7227f264`. Largest files inside `dist`: WASM 14.16 MiB, recognition model 15.86 MiB, detection model 4.60 MiB. Nothing is over 25 MiB, so the zip is not split.

Desktop Chrome, production preview, same origin only:

- First load to network idle: about 0.6s on this machine (not a cold phone install).
- `english.png`: 2.2s including model load, text exact, JS heap about 26 MiB.
- Medal table: 15.7s including model load, same text as the Node run, JS heap about 52 MiB. `performance.memory` does not include all WASM heap.

iOS was not run on a device. The shipped models are the same mobile ONNX files as the previous PWA, so the memory profile of model load is unchanged. The server models were rejected partly because a 50s recognition and an extra ~160 MiB of weights are a bad fit for low-memory phones.

## Still weak

Stylized or curved text (HARANA, circular seals), one dropped `片` on very long lines, receipt loose CER still 0.0337 versus the older 0.0225 run, shareholder names split across table columns, the book's perspective line, `二等座` read as `等座`, `mmol` read as `mmo1`, and rank 7 on the medal table. Handwriting is not measured by this harness.
