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

## Further round, then stop

Two more tries on the existing 46 and the synthetic 22 only. Neither was kept.

- Owned-window split for wide lines. A window can contain the missing `片`, but the stitched text also duplicated characters (`高高` on `stress_gao_xiao.png`, `号号` on `punctuation.png`). Synthetic loose CER moved 0.0008 → 0.0023 and strict 0.0405 → 0.0418. `long_line.png` still dropped `片`. Reverted.
- Detector long side 1280 → 960. Receipt loose CER stayed 0.0337. Overall loose CER rose 0.0344 → 0.0512, document 0.0192 → 0.0536, street signs 0.1388 → 0.1530, vertical 0.0566 → 0.0755, and the long letterbox line became a miss again. Reverted.

No image-specific branches were added. The recognizer code is unchanged from `ba82fc87`.

## Official holdout

The earlier unlabeled downloads are not an accuracy check. This round uses 32 images that were not in the 46, chosen by a fixed index rule before any recognition, and scored with `scripts/holdout_protocol.py` (self-checked, then not edited).

Provenance, images untracked, only the selected texts are in `tests/holdout/labels.json`:

| source | images | lines | language | how it was obtained |
| --- | ---: | ---: | --- | --- |
| SROIE task 1 train | 12 | 627 | English receipts | ICDAR 2019 scanned receipts. The challenge site requires an account. These bytes are the docTR static mirror of that official train zip (`sroie2019_train_task1.zip`). Research use. 12 stems evenly spaced through the sorted file list. |
| FUNSD testing split | 10 | 242 | English forms | https://guillaumejaume.github.io/FUNSD/dataset.zip . EPFL-LTS5 terms: non-commercial research and education only. Words were grouped into lines by the frozen vertical-center rule. 10 files evenly spaced through the sorted test list. |
| XFUND zh validation | 10 | 235 | Simplified Chinese forms | https://github.com/doc-analysis/XFUND/releases/tag/v1.0 (`zh.val.json`, `zh.val.zip`). Research benchmark from the XFUND paper. The repo README has no separate license file. 10 ids evenly spaced through `zh_val_0` … `zh_val_49`. |

Not in this holdout: Chinese scene text, handwriting, Japanese, and the other XFUND languages. The model dictionary is Chinese and English, so those three sets are in-vocabulary. They are still forms and receipts, not photos of signs.

37 ground-truth lines shorter than 2 loose characters are excluded and counted (all of them are on SROIE). 1,067 lines are scored.

Page CER compares the full strings. Line CER is one-to-one: a ground-truth line that does not find its own OCR line within loose CER 0.3 is a full miss. Extra OCR lines are counted and are not folded into the CER. That is why a system can have a similar page CER and a very different line-miss rate.

| system | page loose | page strict | line loose | unmatched GT lines | unmatched OCR lines |
| --- | ---: | ---: | ---: | ---: | ---: |
| Imported baseline `3244517` | 0.2669 | 0.2821 | 0.3711 | 524 / 1067 (0.4911) | 348 |
| This branch | 0.2677 | 0.2830 | 0.3647 | 521 / 1067 (0.4883) | 363 |
| RapidOCR, same mobile ONNX weights | 0.2675 | 0.2929 | 0.5246 | 430 / 1067 (0.4030) | 1162 |

| source | baseline page loose / line miss | branch page loose / line miss | RapidOCR page loose / line miss |
| --- | --- | --- | --- |
| SROIE (en) | 0.4502 / 0.7847 | 0.4502 / 0.7847 | 0.4483 / 0.3814 |
| FUNSD (en) | 0.2062 / 0.1240 | 0.2054 / 0.1240 | 0.2042 / 0.3512 |
| XFUND zh | 0.1375 / 0.1319 | 0.1423 / 0.1191 | 0.1463 / 0.5106 |

SROIE is identical for the baseline and this branch, including the high line-miss rate. Thermal receipt lines are often merged or broken differently from the official rows, so one-to-one matching leaves many official lines unmatched even when the page string is partly right. Page CER near 0.45 is the character error, and it did not move. RapidOCR's lower SROIE line-miss comes with 1,162 unmatched OCR lines overall and a worse line CER, especially on the Chinese forms (line loose 0.6691).

The branch is not meaningfully worse than the baseline on this set (page loose 0.2669 → 0.2677, line loose 0.3711 → 0.3647). The per-image mean page-loose change is +0.002. That is not a clear regression, so no second holdout was drawn and the recognizer was not changed again. These forms and receipts also do not contain the vertical-column case the branch was aimed at, so a flat result here does not cancel the gain on the 46.

## Size, startup, memory

Service worker cache is `yanlu-v4`, not the deployed `yanlu-v3`.

Production zip:

- Repository path: `release/yanlu-pwa.zip`
- Artifact copy: `/opt/cursor/artifacts/yanlu-pwa.zip`
- Agent store copy: `/cursor/stores/self/artifacts/yanlu-pwa.zip`
- 23,609,811 bytes (22.52 MiB)
- SHA-256 `9ec80380a0e2fd482c19a461ddac6d4aaeca62e33baa99c870cb866d7227f264`

Largest files inside `dist`: WASM 14.16 MiB, recognition model 15.86 MiB, detection model 4.60 MiB. Nothing exceeds 25 MiB, so the zip is not split.

Desktop Chrome, production preview, requests only to `127.0.0.1`:

- Load to network idle: about 0.6s on this machine, not a cold phone install.
- `english.png`: 2.2s including model load, text exact, JS heap about 26 MiB.
- Medal table: 15.7s including model load, same text as Node, JS heap about 52 MiB. `performance.memory` does not include the whole WASM heap.
- Rotated fixture `rot90.png` in the rebuilt app: three lines, with a stray colon before `Invoice`.

Node, this machine, the 32 holdout images, models resident:

- This branch: 52.4s recognition, mean about 1.6s per image, peak RSS 1,092,427,776 bytes (about 1.02 GiB).
- Baseline: 51.4s, peak RSS 1,091,411,968 bytes.
- RapidOCR with the same weights: 38.9s. RSS was not sampled.

iOS was not run on a device. The shipped weights are still the mobile models. The server models stay out because of the 50s recognition and the extra ~160 MiB of weights.

## Still weak

Stylized or curved text, the missing `片` on `long_line.png`, receipt loose CER 0.0337 on the 46 versus an older 0.0225 run, and SROIE page loose CER about 0.45 on the new receipts. Shareholder names split across columns, `二等座` read as `等座`, `mmol` read as `mmo1`, and rank 7 on the medal table. Handwriting and Chinese scene text were not in the official holdout.
