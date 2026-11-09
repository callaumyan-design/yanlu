/** Character error rate after NFKC and whitespace removal. */
export function normalizeForAccuracy(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, "");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Uint32Array(b.length + 1);
  const curr = new Uint32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev.set(curr);
  }
  return prev[b.length];
}

function accuracyOf(expected: string, actual: string): number {
  if (!expected.length) return actual.length ? 0 : 1;
  const dist = levenshtein(expected, actual);
  return Math.max(0, (expected.length - dist) / expected.length);
}

/** 1 − CER. Whitespace is ignored; compatibility characters are folded with NFKC. */
export function characterAccuracy(expected: string, actual: string): number {
  return accuracyOf(normalizeForAccuracy(expected), normalizeForAccuracy(actual));
}

/** 1 − CER after NFKC, keeping spaces and line breaks. */
export function strictCharacterAccuracy(expected: string, actual: string): number {
  return accuracyOf(expected.normalize("NFKC"), actual.normalize("NFKC"));
}
