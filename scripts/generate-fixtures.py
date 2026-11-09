#!/usr/bin/env python3
"""Render Chinese/English OCR fixtures. Requires Noto Sans CJK SC."""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "fixtures"
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
LATIN = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

font = ImageFont.truetype(FONT, 40, index=2)
font_sm = ImageFont.truetype(FONT, 22, index=2)


def draw_lines(lines, size, font_obj, fill="#161616", bg="#ffffff", pad=36, gap=28):
    image = Image.new("RGB", size, bg)
    draw = ImageDraw.Draw(image)
    y = pad
    for line in lines:
        draw.text((pad, y), line, font=font_obj, fill=fill)
        y += font_obj.size + gap
    return image


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    cases = []

    def add(name, image, text, min_accuracy=0.98):
        path = OUT / f"{name}.png"
        image.save(path)
        cases.append({"file": path.name, "text": text, "minAccuracy": min_accuracy})

    mixed = "砚录可以识别简体中文和 English 混合文本。"
    add("mixed", draw_lines([mixed], (1180, 150), font, pad=40, gap=0), mixed)

    lines = [
        "第一行：春眠不觉晓，处处闻啼鸟。",
        "第二行：Invoice No. 2026-1109 金额 128.50 元",
        "第三行：请于 Friday 前完成付款。",
    ]
    multi = draw_lines(lines, (1100, 320), font, pad=36, gap=36)
    add("multiline", multi, "\n".join(lines))
    add("rot180", multi.rotate(180, expand=True), "\n".join(lines), 0.97)
    add("rot90", multi.rotate(90, expand=True), "\n".join(lines), 0.97)
    add("rot270", multi.rotate(270, expand=True), "\n".join(lines), 0.97)

    skewed = multi.rotate(8, expand=True, fillcolor="white")
    add("skew", skewed, "\n".join(lines), 0.96)

    small_lines = [
        "小字测试：北京市海淀区中关村大街 27 号",
        "Small text ABC-123 mixed with 中文标点，。！？",
    ]
    add(
        "small",
        draw_lines(small_lines, (980, 180), font_sm, pad=28, gap=18),
        "\n".join(small_lines),
        0.96,
    )

    low_text = "低对比度：合同编号 HT-2026-018 已签署。"
    add(
        "low-contrast",
        draw_lines([low_text], (1040, 150), font, fill="#5a534b", bg="#e7e1d6", pad=40),
        low_text,
        0.96,
    )

    para = [
        "离线文字识别不会上传图片。",
        "模型在设备本地运行，支持简体中文、英文和常见标点。",
        "Hello, 世界！This is line three of the paragraph.",
        "电话：010-12345678",
    ]
    add("paragraph", draw_lines(para, (1080, 420), font, pad=32, gap=32), "\n".join(para))

    english = "The quick brown fox jumps over 13 lazy dogs."
    add("english", draw_lines([english], (980, 150), font, pad=36), english)

    (OUT / "expected.json").write_text(json.dumps(cases, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(cases)} fixtures to {OUT}")


if __name__ == "__main__":
    main()
