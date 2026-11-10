"""Extract the frozen holdout subset. Images stay outside the git worktree."""

from __future__ import annotations

import csv
import json
import zipfile
from pathlib import Path

from holdout_protocol import group_tokens

ROOT = Path("/tmp/holdout-dl")
OUT_IMG = Path("/tmp/holdout/images")
OUT_JSON = Path("/workspace/tests/holdout/labels.json")


def spaced(items: list, count: int) -> list:
    items = list(items)
    if len(items) <= count:
        return items
    return [items[(i * (len(items) - 1)) // (count - 1)] for i in range(count)]


def sroie_lines(text: str) -> list[str]:
    rows = []
    for row in csv.reader(text.splitlines()):
        if len(row) < 9:
            continue
        try:
            coords = [float(value) for value in row[:8]]
        except ValueError:
            continue
        label = ",".join(row[8:]).strip()
        if not label:
            continue
        xs = coords[0::2]
        ys = coords[1::2]
        rows.append((sum(ys) / 4, sum(xs) / 4, label))
    rows.sort()
    return [label for _, _, label in rows]


def funsd_tokens(payload: dict) -> list[dict]:
    tokens = []
    for block in payload.get("form", []):
        for word in block.get("words", []):
            text = str(word.get("text") or "").strip()
            box = word.get("box") or []
            if not text or len(box) != 4:
                continue
            x0, y0, x1, y1 = box
            tokens.append({"text": text, "x0": x0, "y0": y0, "x1": x1, "y1": y1})
    return tokens


def xfund_tokens(doc: dict) -> list[dict]:
    tokens = []
    for entity in doc.get("document", []):
        text = str(entity.get("text") or "").strip()
        box = entity.get("box") or []
        if not text or len(box) != 4:
            continue
        x0, y0, x1, y1 = box
        tokens.append({"text": text, "x0": x0, "y0": y0, "x1": x1, "y1": y1})
    return tokens


def main() -> None:
    OUT_IMG.mkdir(parents=True, exist_ok=True)
    items = []

    with zipfile.ZipFile(ROOT / "sroie.zip") as archive:
        stems = sorted(
            Path(name).stem
            for name in archive.namelist()
            if name.startswith("images/") and name.lower().endswith(".jpg")
        )
        chosen = spaced(stems, 12)
        for stem in chosen:
            raw = archive.read(f"annotations/{stem}.txt").decode("latin-1")
            image_name = f"sroie_{stem}.jpg"
            (OUT_IMG / image_name).write_bytes(archive.read(f"images/{stem}.jpg"))
            items.append(
                {
                    "id": f"sroie_{stem}",
                    "file": image_name,
                    "source": "sroie",
                    "language": "en",
                    "lines": sroie_lines(raw),
                }
            )

    with zipfile.ZipFile(ROOT / "funsd.zip") as archive:
        images = sorted(
            name
            for name in archive.namelist()
            if name.startswith("dataset/testing_data/images/") and name.lower().endswith(".png")
        )
        chosen = spaced(images, 10)
        for name in chosen:
            stem = Path(name).stem
            ann = f"dataset/testing_data/annotations/{stem}.json"
            payload = json.loads(archive.read(ann))
            image_name = f"funsd_{stem}.png"
            (OUT_IMG / image_name).write_bytes(archive.read(name))
            items.append(
                {
                    "id": f"funsd_{stem}",
                    "file": image_name,
                    "source": "funsd",
                    "language": "en",
                    "lines": group_tokens(funsd_tokens(payload)),
                }
            )

    documents = json.loads((ROOT / "zh.val.json").read_text())["documents"]
    by_id = {}
    for doc in documents:
        fname = doc["img"]["fname"]
        by_id[fname] = doc
    names = sorted(by_id, key=lambda name: int(Path(name).stem.split("_")[-1]))
    chosen = spaced(names, 10)
    with zipfile.ZipFile(ROOT / "zh.val.zip") as archive:
        for name in chosen:
            image_name = f"xfund_{name}"
            (OUT_IMG / image_name).write_bytes(archive.read(name))
            items.append(
                {
                    "id": f"xfund_{Path(name).stem}",
                    "file": image_name,
                    "source": "xfund_zh",
                    "language": "zh",
                    "lines": group_tokens(xfund_tokens(by_id[name])),
                }
            )

    payload = {
        "protocol": "holdout-v1",
        "images_tracked": False,
        "image_dir": "/tmp/holdout/images",
        "selection": {
            "sroie": "12 evenly spaced stems from the sorted task-1 train image list",
            "funsd": "10 evenly spaced files from the sorted official testing split",
            "xfund_zh": "10 evenly spaced ids from the sorted zh validation split",
        },
        "items": items,
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(
        json.dumps(
            {
                "images": len(items),
                "by": {source: sum(1 for item in items if item["source"] == source) for source in ("sroie", "funsd", "xfund_zh")},
                "lines": sum(len(item["lines"]) for item in items),
            }
        )
    )


if __name__ == "__main__":
    main()
