/**
 * A search-result description cut to a complete thought.
 *
 * The old trim sliced at 152 characters, which could end mid-word before an
 * ellipsis. This prefers the last sentence boundary inside the limit, then the
 * last word boundary, and only then adds the ellipsis.
 *
 * PURE: no `server-only`, so it tests in the plain `node` environment.
 */
export function snippet(text: string, max = 155): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const window = clean.slice(0, max);
  // A sentence boundary far too early would leave a stub, so require some body.
  const sentence = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
  );
  if (sentence >= 60) return window.slice(0, sentence + 1);
  const room = clean.slice(0, max - 1);
  const space = room.lastIndexOf(" ");
  return `${(space > 0 ? room.slice(0, space) : room).replace(/[\s,;:—-]+$/, "")}…`;
}
