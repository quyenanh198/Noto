import { parseFrontmatter } from '../markdown/links';
import { basename, noteTitle } from '../vault/path';

/*
 * Full-text search over the vault with an Obsidian-like query language:
 *   foo bar          terms are ANDed
 *   "a phrase"       exact phrase
 *   -foo -"phrase"   exclude
 *   tag:#foo         notes with the tag (or a nested tag `foo/...`)
 *   path:folder      path contains the text
 *   file:name        file name contains the text
 *   /regex/i         regular expression (an invalid regex is searched literally)
 */

export type TermKind = 'text' | 'regex' | 'tag' | 'path' | 'file';

export interface QueryTerm {
  kind: TermKind;
  /** Literal text, regex source, tag name without `#`, or path/file substring. */
  value: string;
  /** Regex flags as written (`regex` terms only). */
  flags: string;
  negate: boolean;
}

export interface ParsedQuery {
  terms: QueryTerm[];
}

export interface SearchFile {
  path: string;
  content: string;
}

export interface TagIndex {
  getFilesWithTag(tag: string): string[];
}

export interface SearchOptions {
  matchCase?: boolean;
}

export interface SearchMatch {
  /** 0-based line number. */
  line: number;
  /** Column range [start, end) within `text`. */
  start: number;
  end: number;
  /** The full source line. */
  text: string;
}

export interface SearchResult {
  path: string;
  title: string;
  score: number;
  matches: SearchMatch[];
}

export interface SearchOutput {
  results: SearchResult[];
  /** Number of matching files, before the result cap. */
  totalFiles: number;
  /** Number of matches across all files before the caps. A file with only a title or filter hit counts as one. */
  totalResults: number;
}

export const MAX_MATCHES_PER_FILE = 50;
export const MAX_RESULTS = 200;

// ----- query parsing -----

interface Token {
  type: 'word' | 'phrase' | 'regex';
  value: string;
  flags: string;
  /** The token as written, used when a regex turns out to be invalid. */
  raw: string;
  end: number;
}

const OPERATOR = /^(tag|path|file):/i;

function isSpace(c: string): boolean {
  return /\s/.test(c);
}

export function parseQuery(q: string): ParsedQuery {
  const terms: QueryTerm[] = [];
  let i = 0;
  while (i < q.length) {
    if (isSpace(q[i])) {
      i++;
      continue;
    }
    let negate = false;
    if (q[i] === '-' && i + 1 < q.length && !isSpace(q[i + 1])) {
      negate = true;
      i++;
    }
    let kind: TermKind = 'text';
    const op = OPERATOR.exec(q.slice(i, i + 5));
    if (op) {
      kind = op[1].toLowerCase() as TermKind;
      i += op[0].length;
    }
    const token = readToken(q, i, kind === 'text');
    i = token.end;
    const term = makeTerm(kind, token, negate);
    if (term) terms.push(term);
  }
  return { terms };
}

function readToken(q: string, start: number, allowRegex: boolean): Token {
  if (q[start] === '"') return readPhrase(q, start);
  if (allowRegex && q[start] === '/') {
    const regex = readRegex(q, start);
    if (regex) return regex;
  }
  let i = start;
  while (i < q.length && !isSpace(q[i])) i++;
  const value = q.slice(start, i);
  return { type: 'word', value, flags: '', raw: value, end: i };
}

function readPhrase(q: string, start: number): Token {
  let i = start + 1;
  let value = '';
  while (i < q.length && q[i] !== '"') {
    if (q[i] === '\\' && q[i + 1] === '"') {
      value += '"';
      i += 2;
      continue;
    }
    value += q[i++];
  }
  const end = Math.min(i + 1, q.length);
  return { type: 'phrase', value, flags: '', raw: q.slice(start, end), end };
}

/** `/source/flags` followed by whitespace or the end of the query; null when the token is not a regex. */
function readRegex(q: string, start: number): Token | null {
  let i = start + 1;
  while (i < q.length && q[i] !== '/') i += q[i] === '\\' ? 2 : 1;
  if (i >= q.length) return null;
  const source = q.slice(start + 1, i);
  let j = i + 1;
  while (j < q.length && /[a-z]/i.test(q[j])) j++;
  if (!source || (j < q.length && !isSpace(q[j]))) return null;
  return { type: 'regex', value: source, flags: q.slice(i + 1, j), raw: q.slice(start, j), end: j };
}

function makeTerm(kind: TermKind, token: Token, negate: boolean): QueryTerm | null {
  if (token.type === 'regex') {
    if (isValidRegex(token.value, token.flags)) return { kind: 'regex', value: token.value, flags: token.flags, negate };
    return { kind: 'text', value: token.raw, flags: '', negate };
  }
  const value = kind === 'tag' ? token.value.replace(/^#/, '') : token.value;
  if (!value) return null;
  return { kind, value, flags: '', negate };
}

function isValidRegex(source: string, flags: string): boolean {
  try {
    new RegExp(source, flags);
    return true;
  } catch {
    return false;
  }
}

// ----- matching -----

interface Range {
  start: number;
  end: number;
}

interface Evaluation {
  hit: boolean;
  ranges: Range[];
  titleHit: boolean;
}

type Evaluator = (file: SearchFile, title: string) => Evaluation;

const NO_HIT: Evaluation = { hit: false, ranges: [], titleHit: false };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function regexFlags(userFlags: string, matchCase: boolean): string {
  const flags = new Set(['g', ...userFlags]);
  if (!matchCase) flags.add('i');
  return [...flags].join('');
}

function compileTerm(term: QueryTerm, index: TagIndex | null, matchCase: boolean): Evaluator {
  switch (term.kind) {
    case 'path': {
      const needle = term.value.toLowerCase();
      return (file) => ({ hit: file.path.toLowerCase().includes(needle), ranges: [], titleHit: false });
    }
    case 'file': {
      const needle = term.value.toLowerCase();
      return (file) => ({ hit: basename(file.path).toLowerCase().includes(needle), ranges: [], titleHit: false });
    }
    case 'tag': {
      const tagged = index ? new Set(index.getFilesWithTag(term.value)) : null;
      return (file) => {
        if (tagged && !tagged.has(file.path)) return NO_HIT;
        const ranges = findTagOccurrences(file.content, term.value);
        return { hit: tagged ? true : ranges.length > 0, ranges, titleHit: false };
      };
    }
    default: {
      const rx =
        term.kind === 'regex'
          ? new RegExp(term.value, regexFlags(term.flags, matchCase))
          : new RegExp(escapeRegExp(term.value), matchCase ? 'g' : 'gi');
      return (file, title) => {
        const ranges = findAll(rx, file.content);
        rx.lastIndex = 0;
        const titleHit = rx.test(title);
        rx.lastIndex = 0;
        return { hit: ranges.length > 0 || titleHit, ranges, titleHit };
      };
    }
  }
}

function findAll(rx: RegExp, text: string): Range[] {
  const out: Range[] = [];
  rx.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) {
    if (m[0].length === 0) {
      rx.lastIndex++;
      continue;
    }
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const TAG_CHAR = '[\\p{L}\\p{N}_/-]';

/**
 * Occurrences of `#tag` (or a nested `#tag/...`) in the body. Inside front matter the `#` is optional,
 * so `tags: [foo]` counts as an occurrence of `foo`.
 */
function findTagOccurrences(content: string, tag: string): Range[] {
  const rx = new RegExp(`(^|[^\\p{L}\\p{N}_/#-])(#?)${escapeRegExp(tag)}(?:/${TAG_CHAR}*)?(?!${TAG_CHAR})`, 'gimu');
  const bodyStart = parseFrontmatter(content).bodyStart;
  const out: Range[] = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(content))) {
    const start = m.index + m[1].length;
    if (m[2] !== '#' && start >= bodyStart) continue;
    out.push({ start, end: m.index + m[0].length });
  }
  return out;
}

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start < last.end) last.end = Math.max(last.end, r.end);
    else out.push({ start: r.start, end: r.end });
  }
  return out;
}

function lineStartsOf(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function lineAt(index: number, lineStarts: number[]): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function toLineMatches(content: string, ranges: Range[]): SearchMatch[] {
  if (ranges.length === 0) return [];
  const starts = lineStartsOf(content);
  return ranges.map((r) => {
    const line = lineAt(r.start, starts);
    const lineStart = starts[line];
    const lineEnd = line + 1 < starts.length ? starts[line + 1] - 1 : content.length;
    const text = content.slice(lineStart, lineEnd).replace(/\r$/, '');
    const start = Math.min(r.start - lineStart, text.length);
    const end = Math.min(r.end - lineStart, text.length);
    return { line, start, end, text };
  });
}

/** Run a query over the given files. `index` resolves `tag:` terms; without it tags are found by scanning the text. */
export function runSearch(files: SearchFile[], index: TagIndex | null, query: string, options: SearchOptions = {}): SearchOutput {
  const { terms } = parseQuery(query);
  if (terms.length === 0) return { results: [], totalFiles: 0, totalResults: 0 };
  const matchCase = options.matchCase ?? false;
  const positive = terms.filter((t) => !t.negate).map((t) => compileTerm(t, index, matchCase));
  const negative = terms.filter((t) => t.negate).map((t) => compileTerm(t, index, matchCase));

  const results: SearchResult[] = [];
  let totalResults = 0;
  for (const file of files) {
    const title = noteTitle(file.path);
    if (negative.some((evaluate) => evaluate(file, title).hit)) continue;
    const ranges: Range[] = [];
    let titleHit = false;
    let ok = true;
    for (const evaluate of positive) {
      const r = evaluate(file, title);
      if (!r.hit) {
        ok = false;
        break;
      }
      for (const range of r.ranges) ranges.push(range);
      titleHit ||= r.titleHit;
    }
    if (!ok) continue;
    const matches = toLineMatches(file.content, mergeRanges(ranges));
    totalResults += Math.max(1, matches.length);
    results.push({
      path: file.path,
      title,
      score: (titleHit ? 10 : 0) + matches.length,
      matches: matches.slice(0, MAX_MATCHES_PER_FILE),
    });
  }
  results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return { results: results.slice(0, MAX_RESULTS), totalFiles: results.length, totalResults };
}

export function searchNotes(files: SearchFile[], index: TagIndex | null, query: string, options?: SearchOptions): SearchResult[] {
  return runSearch(files, index, query, options).results;
}

// ----- presentation helpers -----

export interface SnippetSegment {
  text: string;
  mark: boolean;
}

/**
 * Trim a source line to roughly `maxLength` characters around `focus`, splitting it into plain and
 * highlighted segments. `ranges` are the (non-overlapping) column ranges to highlight on this line.
 */
export function buildSnippet(line: string, ranges: Range[], focus: Range, maxLength = 120): SnippetSegment[] {
  const lead = line.length - line.trimStart().length;
  const text = line.trim();
  const shift = (n: number) => Math.max(0, Math.min(text.length, n - lead));
  let from = 0;
  let to = text.length;
  if (text.length > maxLength) {
    from = Math.max(0, shift(focus.start) - Math.floor(maxLength / 4));
    to = Math.min(text.length, from + maxLength);
    from = Math.max(0, to - maxLength);
  }
  const segments: SnippetSegment[] = [];
  const push = (t: string, mark: boolean) => {
    if (t) segments.push({ text: t, mark });
  };
  if (from > 0) push('…', false);
  let pos = from;
  const shifted = ranges.map((r) => ({ start: shift(r.start), end: shift(r.end) })).sort((a, b) => a.start - b.start);
  for (const r of shifted) {
    const start = Math.max(r.start, from, pos);
    const end = Math.min(r.end, to);
    if (end <= start) continue;
    push(text.slice(pos, start), false);
    push(text.slice(start, end), true);
    pos = end;
  }
  push(text.slice(pos, to), false);
  if (to < text.length) push('…', false);
  return segments;
}

/** "3 results in 2 files", or "No results". */
export function formatSummary(totalResults: number, totalFiles: number): string {
  if (totalFiles === 0) return 'No results';
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return `${plural(totalResults, 'result')} in ${plural(totalFiles, 'file')}`;
}
