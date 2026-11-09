/** Parse a PaddleOCR character dictionary. Blank is index 0; ASCII space is appended. */
export function parseDict(text: string): string[] {
  const cleaned = text.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return ["", ...lines, " "];
}

export function assertDict(dict: string[]): void {
  if (dict.length !== 18385) {
    throw new Error(`字典长度应为 18385，实际为 ${dict.length}`);
  }
}
