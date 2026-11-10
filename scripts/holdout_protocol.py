"""Frozen holdout protocol. Do not retune this file after OCR outputs exist.

Selection (fixed before any recognition on these images):
  SROIE task-1 train stems, sorted: 12 evenly spaced indexes.
  FUNSD official testing images, sorted: 10 evenly spaced indexes.
  XFUND zh validation images, sorted by numeric id: 10 evenly spaced indexes.

Line construction:
  SROIE rows are already text lines (text after the 8 box coordinates),
  ordered by the box's vertical center, then left edge.
  FUNSD words and XFUND entities are grouped into lines: a new line starts
  when the vertical centers differ by more than half the taller box.
  Tokens in a line are left to right. Adjacent CJK tokens with a small gap
  are concatenated; everything else is joined with a space.

Scoring, per image, then micro-averaged by character count:
  loose = NFKC with all whitespace removed. strict = NFKC only.
  Page CER compares the joined ground-truth lines to the OCR text as emitted.
  Line match is one-to-one and greedy on loose CER. A pair matches only if
  loose CER <= 0.3. Each unmatched ground-truth line (loose length >= 2)
  costs its full length. Unmatched OCR lines are counted and do not enter
  the CER denominator. Ground-truth lines shorter than 2 loose characters
  are excluded and counted separately.
"""

from __future__ import annotations

import json
import unicodedata
from pathlib import Path


def nfkc(text: str) -> str:
    return unicodedata.normalize("NFKC", text or "")


def loose(text: str) -> str:
    return "".join(nfkc(text).split())


def is_cjk(ch: str) -> bool:
    if not ch:
        return False
    code = ord(ch)
    return (
        0x3400 <= code <= 0x9FFF
        or 0xF900 <= code <= 0xFAFF
        or 0x3040 <= code <= 0x30FF
        or 0xAC00 <= code <= 0xD7AF
    )


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i]
        for j, cb in enumerate(b, 1):
            curr.append(min(curr[-1] + 1, prev[j] + 1, prev[j - 1] + (0 if ca == cb else 1)))
        prev = curr
    return prev[-1]


def cer(gt: str, pred: str) -> float:
    if not gt:
        return 0.0 if not pred else 1.0
    return levenshtein(gt, pred) / len(gt)


def group_tokens(tokens: list[dict]) -> list[str]:
    rows: list[dict] = []
    ordered = sorted(tokens, key=lambda item: ((item["y0"] + item["y1"]) / 2, item["x0"]))
    for token in ordered:
        text = str(token.get("text") or "").strip()
        if not text:
            continue
        cy = (token["y0"] + token["y1"]) / 2
        height = max(1.0, token["y1"] - token["y0"])
        placed = False
        for row in rows:
            if abs(cy - row["cy"]) <= 0.5 * max(height, row["h"]):
                row["items"].append({**token, "text": text})
                count = len(row["items"])
                row["cy"] = (row["cy"] * (count - 1) + cy) / count
                row["h"] = max(row["h"], height)
                placed = True
                break
        if not placed:
            rows.append({"cy": cy, "h": height, "items": [{**token, "text": text}]})
    lines = []
    for row in rows:
        row["items"].sort(key=lambda item: item["x0"])
        parts: list[str] = []
        for index, token in enumerate(row["items"]):
            if index:
                prev = row["items"][index - 1]
                gap = token["x0"] - prev["x1"]
                prev_ch = prev["text"][-1]
                next_ch = token["text"][0]
                if is_cjk(prev_ch) and is_cjk(next_ch) and gap < 0.35 * row["h"]:
                    pass
                else:
                    parts.append(" ")
            parts.append(token["text"])
        line = "".join(parts).strip()
        if line:
            lines.append(line)
    return lines


def match_lines(gt_lines: list[str], ocr_text: str) -> dict:
    gt = [(index, loose(line)) for index, line in enumerate(gt_lines)]
    scored = [(index, text) for index, text in gt if len(text) >= 2]
    ocr_lines = [loose(line) for line in (ocr_text or "").splitlines()]
    ocr = [(index, text) for index, text in enumerate(ocr_lines) if text]
    pairs = []
    for gi, gtext in scored:
        for oi, otext in ocr:
            pairs.append((cer(gtext, otext), gi, oi))
    pairs.sort()
    used_g: set[int] = set()
    used_o: set[int] = set()
    err = 0.0
    for cost, gi, oi in pairs:
        if cost > 0.3:
            break
        if gi in used_g or oi in used_o:
            continue
        used_g.add(gi)
        used_o.add(oi)
        glen = len(dict(scored)[gi])
        err += cost * glen
    chars = 0
    misses = 0
    for gi, gtext in scored:
        chars += len(gtext)
        if gi not in used_g:
            err += len(gtext)
            misses += 1
    extra = [text for oi, text in ocr if oi not in used_o]
    page_l = loose("\n".join(gt_lines))
    page_s = nfkc("\n".join(gt_lines))
    pred_l = loose(ocr_text or "")
    pred_s = nfkc(ocr_text or "")
    return {
        "gtLines": len(scored),
        "matchedLines": len(used_g),
        "unmatchedGtLines": misses,
        "unmatchedOcrLines": len(extra),
        "unmatchedOcrChars": sum(len(text) for text in extra),
        "excludedShort": len(gt) - len(scored),
        "lineChars": chars,
        "lineErr": err,
        "pageLooseChars": len(page_l),
        "pageLooseErr": levenshtein(page_l, pred_l) if page_l else 0,
        "pageStrictChars": len(page_s),
        "pageStrictErr": levenshtein(page_s, pred_s) if page_s else 0,
    }


def aggregate(rows: list[dict]) -> dict:
    keys = [
        "lineChars",
        "lineErr",
        "pageLooseChars",
        "pageLooseErr",
        "pageStrictChars",
        "pageStrictErr",
        "gtLines",
        "matchedLines",
        "unmatchedGtLines",
        "unmatchedOcrLines",
        "unmatchedOcrChars",
        "excludedShort",
    ]
    tot = {key: 0.0 for key in keys}
    by: dict[str, dict] = {}
    for row in rows:
        bucket = by.setdefault(row["source"], {key: 0.0 for key in keys})
        bucket["images"] = bucket.get("images", 0) + 1
        for key in keys:
            tot[key] += row[key]
            bucket[key] += row[key]
    def pack(src: dict, images: int) -> dict:
        return {
            "images": images,
            "pageLooseCER": round(src["pageLooseErr"] / src["pageLooseChars"], 4) if src["pageLooseChars"] else 0,
            "pageStrictCER": round(src["pageStrictErr"] / src["pageStrictChars"], 4) if src["pageStrictChars"] else 0,
            "lineLooseCER": round(src["lineErr"] / src["lineChars"], 4) if src["lineChars"] else 0,
            "lineMissRate": round(src["unmatchedGtLines"] / src["gtLines"], 4) if src["gtLines"] else 0,
            "gtLines": int(src["gtLines"]),
            "matchedLines": int(src["matchedLines"]),
            "unmatchedGtLines": int(src["unmatchedGtLines"]),
            "unmatchedOcrLines": int(src["unmatchedOcrLines"]),
            "unmatchedOcrChars": int(src["unmatchedOcrChars"]),
            "excludedShort": int(src["excludedShort"]),
        }
    return {
        "overall": pack(tot, len(rows)),
        "bySource": {name: pack(src, int(src["images"])) for name, src in by.items()},
    }


def _self_check() -> None:
    # One OCR line may not satisfy two GT lines; the second is an unmatched miss.
    stats = match_lines(["ABCDEFGH", "ZZZZZZ"], "ABCDEFGH\nextra text")
    assert stats["matchedLines"] == 1, stats
    assert stats["unmatchedGtLines"] == 1, stats
    assert stats["unmatchedOcrLines"] == 1, stats
    # A near match under 0.3 is kept; a far line is not.
    close = match_lines(["ABCDEFGH"], "ABCDEFGX")
    assert close["matchedLines"] == 1 and close["unmatchedGtLines"] == 0, close
    far = match_lines(["ABCDEFGH"], "XXXXXXXX")
    assert far["unmatchedGtLines"] == 1 and far["matchedLines"] == 0, far


if __name__ == "__main__":
    _self_check()
    print("protocol self-check ok")
