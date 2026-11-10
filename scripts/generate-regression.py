#!/usr/bin/env python3
"""Render a broader mixed CN/EN regression set with known ground truth."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "regression"
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
LATIN = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

def fnt(size, bold=False, index=2):
    return ImageFont.truetype(BOLD if bold else FONT, size, index=index)

def measure(draw, text, font):
    b = draw.textbbox((0, 0), text, font=font)
    return b[2] - b[0], b[3] - b[1]

def draw_lines(lines, font, fill="#1a1a1a", bg="#ffffff", pad=28, gap=None, min_w=None):
    gap = font.size + 12 if gap is None else gap
    dummy = Image.new("RGB", (8, 8), bg)
    draw = ImageDraw.Draw(dummy)
    widths, heights = [], []
    for line in lines:
        w, h = measure(draw, line, font)
        widths.append(w)
        heights.append(h)
    width = max(widths) + pad * 2
    if min_w:
        width = max(width, min_w)
    height = pad * 2 + sum(max(h, font.size) for h in heights) + gap * (len(lines) - 1)
    image = Image.new("RGB", (width, height), bg)
    draw = ImageDraw.Draw(image)
    y = pad
    for i, line in enumerate(lines):
        draw.text((pad, y), line, font=font, fill=fill)
        y += max(heights[i], font.size) + gap
    return image

def wrap_text(text, font, max_w):
    dummy = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    lines, cur = [], ""
    for ch in text:
        trial = cur + ch
        if measure(dummy, trial, font)[0] > max_w and cur:
            lines.append(cur)
            cur = ch
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    cases = []

    def add(name, image, text, tags):
        path = OUT / f"{name}.png"
        image.save(path)
        cases.append({"file": path.name, "text": text, "tags": tags, "width": image.width, "height": image.height})
        print(name, image.size)

    # 1-3: the user's reported lines at a comfortable size
    user_lines = [
        "Max：每 5 小时及每周用量均为 Pro 的 5 倍。Ultra：每周用量为 Pro 的 10 倍",
        "更高的输出限额，带来更丰富的回复和更优质的 Artifacts",
        "抢先体验 Claude 高级功能",
    ]
    for i, t in enumerate(user_lines):
        add(f"user_line_{i}", draw_lines([t], fnt(28), pad=20, gap=0), t, ["user", "mixed"])

    # 4: all three as a UI card (beige, smaller)
    card_font = fnt(16)
    title = "Max 和 Ultra"
    card_lines = [title] + user_lines
    add("user_card", draw_lines(card_lines, card_font, fill="#222", bg="#f7f6f2", pad=24, gap=22, min_w=740), "\n".join(card_lines), ["user", "ui", "small"])

    # 5: denser phone-width wrapped card
    phone_w, phone_pad, body = 390, 18, fnt(14)
    wrapped = []
    for t in card_lines:
        wrapped.extend(wrap_text(t, body, phone_w - phone_pad * 2))
    add("user_phone", draw_lines(wrapped, body, fill="#2a2a2a", bg="#f7f7f2", pad=phone_pad, gap=16, min_w=phone_w), "\n".join(wrapped), ["user", "ui", "small", "wrap"])

    # 6: 2x phone (typical screenshot scale)
    body2 = fnt(28)
    wrapped2 = []
    for t in card_lines:
        wrapped2.extend(wrap_text(t, body2, 390 * 2 - 36 * 2))
    add("user_phone_2x", draw_lines(wrapped2, body2, fill="#2a2a2a", bg="#f7f7f2", pad=36, gap=28, min_w=780), "\n".join(wrapped2), ["user", "ui", "wrap"])

    # 7: small mixed address / invoice
    small_lines = [
        "小字测试：北京市海淀区中关村大街 27 号",
        "Invoice No. 2026-1109 金额 128.50 元",
        "电话：010-12345678，请于 Friday 前完成。",
    ]
    add("small_invoice", draw_lines(small_lines, fnt(15), pad=20, gap=14), "\n".join(small_lines), ["small", "mixed", "numbers"])

    # 8: dense UI settings list
    dense = [
        "账号设置  Account Settings",
        "已开启两步验证  2FA is ON",
        "上次登录 2026-11-10 14:32",
        "流量剩余 3.5 GB / 10 GB",
        "版本 v1.0.0 (build 2048)",
    ]
    add("dense_settings", draw_lines(dense, fnt(15), fill="#1b1b1b", bg="#f3f3f3", pad=16, gap=10, min_w=560), "\n".join(dense), ["ui", "dense", "mixed"])

    # 9: long single line
    long_line = "这是一条很长的说明：离线 OCR 必须在本地完成识别，不得上传图片，也不得访问 api.example.com 或任何远程模型。"
    add("long_line", draw_lines([long_line], fnt(22), pad=16, gap=0), long_line, ["long", "mixed"])

    # 10: numbers and punctuation cluster
    nums = "合同编号 HT-2026-018，金额 ¥12,847.50，税率 13%，合计 RMB 14517.68。"
    add("numbers", draw_lines([nums], fnt(22), pad=20, gap=0), nums, ["numbers", "punct"])

    # 11: low contrast
    low = "低对比度：更高的输出限额与更优质的 Artifacts，请在 5 小时内完成。"
    add("low_contrast", draw_lines([low], fnt(22), fill="#5a534b", bg="#e7e1d6", pad=24, gap=0), low, ["low-contrast", "mixed"])

    # 12: paragraph
    para = [
        "离线文字识别不会上传图片。",
        "模型在设备本地运行，支持简体中文、英文和常见标点。",
        "Hello, 世界！This is line three of the paragraph.",
        "抢先体验 Claude 高级功能，每 5 小时用量为 Pro 的 5 倍。",
    ]
    add("paragraph", draw_lines(para, fnt(22), pad=24, gap=20), "\n".join(para), ["paragraph", "mixed"])

    # 13: English only
    english = "The quick brown fox jumps over 13 lazy dogs."
    add("english", draw_lines([english], fnt(24), pad=24, gap=0), english, ["english"])

    # 14: punctuation-heavy
    punct = "问：这是什么？答：这是 OCR（文字识别）测试，包含逗号、顿号、分号；以及“引号”和【括号】！"
    add("punctuation", draw_lines([punct], fnt(20), pad=20, gap=0), punct, ["punct"])

    # 15: bold heading + body
    heading_img = draw_lines(["更高的输出限额", "带来更丰富的回复和更优质的 Artifacts。抢先体验 Claude 高级功能。"], fnt(20), pad=24, gap=18)
    # draw heading in bold by composing
    hfont, bfont = fnt(26, bold=True), fnt(18)
    heading_lines = ["更高的输出限额", "带来更丰富的回复和更优质的 Artifacts。", "抢先体验 Claude 高级功能。"]
    # reuse draw with mixed fonts
    dummy = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    fonts = [hfont, bfont, bfont]
    width = max(measure(dummy, t, fonts[i])[0] for i, t in enumerate(heading_lines)) + 48
    height = 48 + 36 + 28 * 2 + 40
    himg = Image.new("RGB", (width, 200), "#ffffff")
    d = ImageDraw.Draw(himg)
    y = 24
    d.text((24, y), heading_lines[0], font=hfont, fill="#111")
    y += 48
    d.text((24, y), heading_lines[1], font=bfont, fill="#333")
    y += 32
    d.text((24, y), heading_lines[2], font=bfont, fill="#333")
    add("heading_body", himg.crop((0, 0, width, y + 28)), "\n".join(heading_lines), ["ui", "mixed"])

    # 16: stress 高 / 小 / spaces
    stress = "提高效率：从小学到高中，每 5 小时复习一次高级语法。小高同学使用 Claude 高级功能。"
    add("stress_gao_xiao", draw_lines([stress], fnt(22), pad=20, gap=0), stress, ["stress", "mixed"])

    # 17: very small 12px text
    tiny = [
        "更高的输出限额，带来更丰富的回复和更优质的 Artifacts",
        "Max：每 5 小时及每周用量均为 Pro 的 5 倍。",
    ]
    add("tiny12", draw_lines(tiny, fnt(12), pad=12, gap=8, min_w=520), "\n".join(tiny), ["tiny", "mixed"])

    # 18: slightly blurred screenshot simulation
    src = draw_lines(user_lines, fnt(18), fill="#1f1f1f", bg="#faf9f5", pad=22, gap=16, min_w=700)
    blurred = src.filter(ImageFilter.GaussianBlur(radius=0.45))
    add("soft_blur", blurred, "\n".join(user_lines), ["blur", "user"])

    # 19: table-like two columns
    table = [
        "项目                数值",
        "Pro 用量            1 倍",
        "Max 用量            5 倍",
        "Ultra 每周用量      10 倍",
        "输出限额            更高",
    ]
    add("table", draw_lines(table, fnt(16), pad=20, gap=12, min_w=420), "\n".join(table), ["ui", "numbers", "dense"])

    # 20: mixed product copy
    product = [
        "砚录 1.0.0 完全离线，支持 iOS、Android 和 PC。",
        "识别引擎为 PaddleOCR PP-OCRv5 mobile，字典 18383 字。",
        "请将截图拖入窗口，或按 Ctrl+V 粘贴。",
    ]
    add("product", draw_lines(product, fnt(20), pad=22, gap=16), "\n".join(product), ["mixed", "numbers"])

    # 21: dark-on-cream Claude-like palette, medium size
    claude = draw_lines(user_lines, fnt(17), fill="#3d3d3a", bg="#faf9f5", pad=28, gap=18, min_w=720)
    add("claude_palette", claude, "\n".join(user_lines), ["user", "ui"])

    # 22: existing style mixed sentence
    mixed = "砚录可以识别简体中文和 English 混合文本。"
    add("mixed_sentence", draw_lines([mixed], fnt(32), pad=32, gap=0), mixed, ["mixed"])

    (OUT / "expected.json").write_text(json.dumps(cases, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(cases)} fixtures")

if __name__ == "__main__":
    main()
