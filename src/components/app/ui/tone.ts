/** Stable initials tint (1–5) for a name/id; colours live in tokens.css (--tint-n). */
export const toneIndex = (seed: string) => ([...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % 5) + 1;

export const toneStyle = (seed: string) => {
  const n = toneIndex(seed);
  return { background: `var(--tint-${n})`, color: `var(--tint-${n}-ink)` };
};

/** "Maya Patel" → "MP". */
export const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).map((s) => s[0]).join('').slice(0, 2).toUpperCase() || '?';
