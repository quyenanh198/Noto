import type { HeadingRef, NoteMetadata, TagRef, TextRange, WikiLink } from '../types';
import { noteTitle } from '../vault/path';

/**
 * Regions of text that should not be scanned for links/tags: fenced code blocks and inline code.
 * Returns sorted, non-overlapping [start, end) ranges.
 */
export function codeRegions(content: string): Array<[number, number]> {
  const regions: Array<[number, number]> = [];
  const fence = /^(\s{0,3})(`{3,}|~{3,})[^\n]*$/gm;
  let m: RegExpExecArray | null;
  let openFence: { start: number; marker: string } | null = null;
  while ((m = fence.exec(content))) {
    const marker = m[2];
    if (!openFence) {
      openFence = { start: m.index, marker };
    } else if (marker[0] === openFence.marker[0] && marker.length >= openFence.marker.length) {
      regions.push([openFence.start, m.index + m[0].length]);
      openFence = null;
    }
  }
  if (openFence) regions.push([openFence.start, content.length]);

  const inline = /(`+)[^`\n][\s\S]*?\1/g;
  while ((m = inline.exec(content))) {
    const start = m.index;
    const end = start + m[0].length;
    if (regions.some(([s, e]) => start >= s && start < e)) continue;
    regions.push([start, end]);
  }
  regions.sort((a, b) => a[0] - b[0]);
  return regions;
}

function inRegions(index: number, regions: Array<[number, number]>): boolean {
  for (const [s, e] of regions) {
    if (index < s) return false;
    if (index >= s && index < e) return true;
  }
  return false;
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

function computeLineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function range(content: string, start: number, end: number, lineStarts = computeLineStarts(content)): TextRange {
  return { start, end, line: lineAt(start, lineStarts) };
}

const WIKILINK = /(!?)\[\[([^\]\n]*?)\]\]/g;

/** Parse `[[target|alias]]`, `[[target#heading]]`, `[[target#^block]]`, `![[embed]]`. */
export function parseWikiLinks(content: string, regions = codeRegions(content)): WikiLink[] {
  const out: WikiLink[] = [];
  const lineStarts = computeLineStarts(content);
  let m: RegExpExecArray | null;
  WIKILINK.lastIndex = 0;
  while ((m = WIKILINK.exec(content))) {
    if (inRegions(m.index, regions)) continue;
    const inner = m[2];
    if (!inner.trim()) continue;
    const link = parseLinkInner(inner);
    if (!link) continue;
    out.push({
      ...link,
      embed: m[1] === '!',
      raw: m[0],
      position: range(content, m.index, m.index + m[0].length, lineStarts),
    });
  }
  return out;
}

/** Split the inside of `[[...]]` into target / heading / block / alias. Exported for autocomplete. */
export function parseLinkInner(inner: string): Omit<WikiLink, 'embed' | 'raw' | 'position'> | null {
  const pipe = inner.indexOf('|');
  const alias = pipe === -1 ? undefined : inner.slice(pipe + 1).trim();
  let target = pipe === -1 ? inner : inner.slice(0, pipe);
  let heading: string | undefined;
  let block: string | undefined;
  const hash = target.indexOf('#');
  if (hash !== -1) {
    const frag = target.slice(hash + 1).trim();
    target = target.slice(0, hash);
    if (frag.startsWith('^')) block = frag.slice(1);
    else if (frag) heading = frag;
  }
  target = target.trim();
  if (!target && !heading && !block) return null;
  let display = alias;
  if (!display) {
    display = target;
    if (heading) display = target ? `${target} > ${heading}` : heading;
    else if (block) display = target ? `${target} > ^${block}` : `^${block}`;
  }
  return { target, alias, heading, block, display };
}

const TAG = /(^|[^\w#&/\\`])#([\p{L}\p{N}_\-/]+)/gmu;

/** Inline `#tags`. A tag must contain at least one non-digit character. */
export function parseInlineTags(content: string, regions = codeRegions(content)): TagRef[] {
  const out: TagRef[] = [];
  const lineStarts = computeLineStarts(content);
  let m: RegExpExecArray | null;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(content))) {
    const start = m.index + m[1].length;
    if (inRegions(start, regions)) continue;
    let name = m[2].replace(/\/+$/, '');
    if (!name || /^\d+$/.test(name)) continue;
    // Ignore a trailing dash-only segment
    name = name.replace(/-+$/, '');
    if (!name) continue;
    out.push({ name, position: range(content, start, start + 1 + m[2].length, lineStarts) });
  }
  return out;
}

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;

export function parseHeadings(content: string, regions = codeRegions(content)): HeadingRef[] {
  const out: HeadingRef[] = [];
  const lineStarts = computeLineStarts(content);
  let m: RegExpExecArray | null;
  HEADING.lastIndex = 0;
  while ((m = HEADING.exec(content))) {
    if (inRegions(m.index, regions)) continue;
    out.push({ level: m[1].length, text: m[2].trim(), position: range(content, m.index, m.index + m[0].length, lineStarts) });
  }
  return out;
}

export interface Frontmatter {
  data: Record<string, unknown>;
  /** Byte offset where the body starts (0 when no frontmatter). */
  bodyStart: number;
}

/**
 * Minimal YAML front matter: `key: value`, `key: [a, b]`, and block lists (`- a`).
 * Values are strings, numbers, booleans, or string arrays. Not a full YAML parser.
 */
export function parseFrontmatter(content: string): Frontmatter {
  if (!content.startsWith('---')) return { data: {}, bodyStart: 0 };
  const firstNl = content.indexOf('\n');
  if (firstNl === -1 || content.slice(0, firstNl).trim() !== '---') return { data: {}, bodyStart: 0 };
  const endMatch = /^(---|\.\.\.)[ \t]*$/m;
  const rest = content.slice(firstNl + 1);
  const end = endMatch.exec(rest);
  if (!end) return { data: {}, bodyStart: 0 };
  const yaml = rest.slice(0, end.index);
  const bodyStart = firstNl + 1 + end.index + end[0].length + 1;
  const data: Record<string, unknown> = {};
  let currentKey: string | null = null;
  for (const rawLine of yaml.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s*-\s*(.*)$/.exec(line);
    if (item && currentKey) {
      const arr = Array.isArray(data[currentKey]) ? (data[currentKey] as unknown[]) : [];
      arr.push(scalar(item[1]));
      data[currentKey] = arr;
      continue;
    }
    const kv = /^([\w.\-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    currentKey = kv[1];
    const value = kv[2].trim();
    if (value === '') data[currentKey] = [];
    else if (value.startsWith('[') && value.endsWith(']')) {
      data[currentKey] = value
        .slice(1, -1)
        .split(',')
        .map((s) => scalar(s))
        .filter((s) => s !== '');
    } else data[currentKey] = scalar(value);
  }
  return { data, bodyStart: Math.min(bodyStart, content.length) };
}

function scalar(raw: string): string | number | boolean {
  const s = raw.trim().replace(/^["']|["']$/g, '');
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s !== '' && !Number.isNaN(Number(s)) && /^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

/** Tags declared in front matter (`tags: [a, b]`, `tags: a, b`, or `tag: a`). Names without `#`. */
export function frontmatterTags(data: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of ['tags', 'tag']) {
    const v = data[key];
    if (Array.isArray(v)) out.push(...v.map(String));
    else if (typeof v === 'string') out.push(...v.split(/[,\s]+/));
  }
  return out.map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
}

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu);
  return m ? m.length : 0;
}

/** Parse everything we index about a note. */
export function parseNote(path: string, content: string): NoteMetadata {
  const fm = parseFrontmatter(content);
  const body = content.slice(fm.bodyStart);
  const regions = codeRegions(content);
  // Front matter is not scanned for links/tags/headings.
  if (fm.bodyStart > 0) regions.unshift([0, fm.bodyStart]);
  const tags = parseInlineTags(content, regions);
  for (const t of frontmatterTags(fm.data)) {
    tags.unshift({ name: t, position: { start: 0, end: 0, line: 0 } });
  }
  return {
    path,
    title: noteTitle(path),
    links: parseWikiLinks(content, regions),
    tags,
    headings: parseHeadings(content, regions),
    frontmatter: fm.data,
    wordCount: countWords(body),
  };
}
