// server/src/utils/search.ts — escape user-provided search text for a MongoDB `$regex`.
// Why: NFR-009 list endpoints expose `?search=`; a user must not be able to inject regex operators
// or cause catastrophic backtracking, so the text is treated as a literal substring only (the
// operator-key sanitiser already rejects `$`/`.` query objects before this point).
// Invariants: pure function; output is safe to embed in `{ name: { $regex: escaped, $options: 'i' } }`.

const REGEX_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g;

/** Escape every regex metacharacter so the search behaves as a case-insensitive `contains`. */
export function escapeRegex(value: string): string {
  return value.replace(REGEX_SPECIAL_CHARACTERS, '\\$&');
}
