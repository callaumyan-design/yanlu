import { describe, expect, it } from "vitest";
import { restoreOcrSpaces } from "@/ocr/text";

describe("restoreOcrSpaces", () => {
  it("inserts spaces between CJK and Latin or digits", () => {
    expect(restoreOcrSpaces("每5小时")).toBe("每 5 小时");
    expect(restoreOcrSpaces("均为Pro的5倍")).toBe("均为 Pro 的 5 倍");
    expect(restoreOcrSpaces("抢先体验Claude高级功能")).toBe("抢先体验 Claude 高级功能");
    expect(restoreOcrSpaces("更优质的Artifacts")).toBe("更优质的 Artifacts");
    expect(restoreOcrSpaces("砚录1.0.0完全离线")).toBe("砚录 1.0.0 完全离线");
  });

  it("does not insert spaces around punctuation", () => {
    expect(restoreOcrSpaces("Max：每 5 小时")).toBe("Max：每 5 小时");
    expect(restoreOcrSpaces("的 5 倍。Ultra：每周")).toBe("的 5 倍。Ultra：每周");
    expect(restoreOcrSpaces("Hello,世界！")).toBe("Hello,世界！");
  });

  it("folds ideographic spaces and does not double existing spaces", () => {
    expect(restoreOcrSpaces("每\u30005\u3000小时")).toBe("每 5 小时");
    expect(restoreOcrSpaces("抢先体验 Claude 高级功能")).toBe("抢先体验 Claude 高级功能");
  });
});
