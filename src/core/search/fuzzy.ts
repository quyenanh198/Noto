/**
 * Fuzzy subsequence matching for the quick switcher and command palette.
 *
 * A query matches a text when every query character appears in the text in order
 * (case-insensitive). Among all such alignments the best-scoring one is chosen:
 * consecutive characters, characters at word starts and matches near the beginning
 * score higher; gaps between matched characters and unmatched trailing text cost points.
 */

export interface FuzzyMatch {
  score: number;
  /** Indices into `text` of the matched characters, in order. */
  indices: number[];
}

export interface FuzzyResult<T> {
  item: T;
  score: number;
  indices: number[];
  /** Which of the item's text fields produced the match (index into the `getText` result). */
  field: number;
}

export interface HighlightSegment {
  text: string;
  matched: boolean;
}

const SCORE_MATCH = 1;
const BONUS_CONSECUTIVE = 8;
const BONUS_WORD_START = 6;
/** Extra for matching the whole text (the query equals the text). */
const BONUS_EXACT = 10;
/** Per skipped character between two matched characters. */
const PENALTY_GAP = 1;
/** Per character before the first match, capped. */
const PENALTY_LEADING = 0.5;
const MAX_PENALTY_LEADING = 6;
/** Per unmatched character overall, so shorter texts win ties. */
const PENALTY_UNMATCHED = 0.1;

const SEPARATORS = new Set([' ', '/', '\\', '-', '_', '.', ',', ':', '(', ')', '[', ']']);

/** True when `text[i]` starts a word: first char, after a separator, or a camelCase boundary. */
export function isWordStart(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1];
  if (SEPARATORS.has(prev)) return true;
  const cur = text[i];
  const prevIsLower = prev !== prev.toUpperCase();
  const curIsUpper = cur !== cur.toLowerCase();
  return prevIsLower && curIsUpper;
}

function lowerChars(s: string): string[] {
  const out = new Array<string>(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s[i].toLowerCase();
  return out;
}

/** Best-scoring subsequence alignment of `query` in `text`, or null when it does not match. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const n = query.length;
  const m = text.length;
  if (n === 0) return { score: 0, indices: [] };
  if (n > m) return null;
  const q = lowerChars(query);
  const t = lowerChars(text);
  const NEG = -Infinity;

  // row[j]: best score with query[i] matched at text[j]; back[i][j]: position of query[i-1] in that alignment.
  let prevRow: Float64Array | null = null;
  const back: Int32Array[] = [];
  for (let i = 0; i < n; i++) {
    const row = new Float64Array(m).fill(NEG);
    const bp = new Int32Array(m).fill(-1);
    // Running max of prevRow[k] + k * PENALTY_GAP over k <= j - 2, for the "skip some characters" transition.
    let gapBest = NEG;
    let gapK = -1;
    for (let j = 0; j < m; j++) {
      if (prevRow && j >= 2) {
        const v = prevRow[j - 2] + (j - 2) * PENALTY_GAP;
        if (v > gapBest) {
          gapBest = v;
          gapK = j - 2;
        }
      }
      if (t[j] !== q[i]) continue;
      const own = SCORE_MATCH + (isWordStart(text, j) ? BONUS_WORD_START : 0);
      if (!prevRow) {
        row[j] = own - Math.min(MAX_PENALTY_LEADING, j * PENALTY_LEADING);
        continue;
      }
      let best = NEG;
      let bestK = -1;
      if (j >= 1 && prevRow[j - 1] !== NEG) {
        best = prevRow[j - 1] + BONUS_CONSECUTIVE;
        bestK = j - 1;
      }
      if (gapBest !== NEG) {
        const cand = gapBest - (j - 1) * PENALTY_GAP;
        if (cand > best) {
          best = cand;
          bestK = gapK;
        }
      }
      if (best === NEG) continue;
      row[j] = own + best;
      bp[j] = bestK;
    }
    prevRow = row;
    back.push(bp);
  }

  const last = prevRow as Float64Array;
  let bestJ = -1;
  let bestScore = NEG;
  for (let j = 0; j < m; j++) {
    if (last[j] > bestScore) {
      bestScore = last[j];
      bestJ = j;
    }
  }
  if (bestJ === -1) return null;

  const indices = new Array<number>(n);
  let j = bestJ;
  for (let i = n - 1; i >= 0; i--) {
    indices[i] = j;
    j = back[i][j];
  }
  let score = bestScore - (m - n) * PENALTY_UNMATCHED;
  if (n === m) score += BONUS_EXACT;
  return { score, indices };
}

/**
 * Filter and rank `items` by fuzzy match against one or more text fields each; the best field wins.
 * Sorted by score descending, ties keep the original order. A blank query returns every item
 * with score 0 in the original order.
 */
export function fuzzyFilter<T>(query: string, items: T[], getText: (item: T) => string | string[]): FuzzyResult<T>[] {
  const q = query.trim();
  if (!q) return items.map((item) => ({ item, score: 0, indices: [], field: 0 }));
  const ranked: Array<{ result: FuzzyResult<T>; order: number }> = [];
  for (let order = 0; order < items.length; order++) {
    const item = items[order];
    const texts = getText(item);
    const fields = Array.isArray(texts) ? texts : [texts];
    let best: FuzzyResult<T> | null = null;
    for (let field = 0; field < fields.length; field++) {
      const match = fuzzyMatch(q, fields[field]);
      if (match && (best === null || match.score > best.score)) best = { item, score: match.score, indices: match.indices, field };
    }
    if (best) ranked.push({ result: best, order });
  }
  ranked.sort((a, b) => b.result.score - a.result.score || a.order - b.order);
  return ranked.map((r) => r.result);
}

/** Split `text` into runs of matched / unmatched characters for rendering highlights. */
export function highlightMatch(text: string, indices: number[]): HighlightSegment[] {
  const matched = new Set(indices);
  const segments: HighlightSegment[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || matched.has(i) !== matched.has(start)) {
      segments.push({ text: text.slice(start, i), matched: matched.has(start) });
      start = i;
    }
  }
  return segments;
}
