/** CJK letters/syllables (not punctuation) used for spacing against Latin/digits. */
export function isCjkLetter(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x3400 && c <= 0x9fff) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0x3040 && c <= 0x30ff) ||
    (c >= 0xac00 && c <= 0xd7af) ||
    (c >= 0x20000 && c <= 0x2ceaf)
  );
}

export function isAlnum(ch: string): boolean {
  return /[A-Za-z0-9]/.test(ch);
}

/**
 * PP-OCRv5 often skips the space class between CJK and Latin/digits.
 * Restore those spaces, and fold ideographic/unicode spaces to ASCII.
 * Punctuation is left untouched, so "Max：每" and "倍。Ultra" stay compact.
 */
export function restoreOcrSpaces(text: string): string {
  const folded = text.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF]/g, " ");
  let out = "";
  for (const ch of folded) {
    if (out.length) {
      const prev = out[out.length - 1] as string;
      if (prev !== " " && ch !== " " && prev !== "\n" && ch !== "\n") {
        if ((isCjkLetter(prev) && isAlnum(ch)) || (isAlnum(prev) && isCjkLetter(ch))) {
          out += " ";
        }
      }
    }
    out += ch;
  }
  return out;
}
