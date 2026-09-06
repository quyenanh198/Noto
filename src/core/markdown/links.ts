import type { HeadingRef, NoteMetadata, TagRef, TextRange, WikiLink } from '../types';
import { noteTitle } from '../vault/path';

type Region = [number, number];

/** A source line the way CommonMark sees block content: blockquote markers and indentation stripped. */
interface Line {
  start: number;
  /** End of the line's text (before the newline and a trailing `\r`). */
  end: number;
  /** Number of leading `>` markers. */
  quotes: number;
  /** Indentation after the quote markers, in columns (a tab advances to the next multiple of 4). */
  indent: number;
  /** The text after quote markers and indentation. */
  text: string;
  blank: boolean;
}

function scanLine(content: string, start: number, end: number): Line {
  if (end > start && content.charCodeAt(end - 1) === 13) end--;
  let i = start;
  let quotes = 0;
  for (;;) {
    let j = i;
    while (j < end && j - i < 3 && content.charCodeAt(j) === 32) j++;
    if (j >= end || content.charCodeAt(j) !== 62 /* > */) break;
    j++;
    if (j < end && content.charCodeAt(j) === 32) j++;
    quotes++;
    i = j;
  }
  let indent = 0;
  while (i < end) {
    const c = content.charCodeAt(i);
    if (c === 32) indent++;
    else if (c === 9) indent += 4 - (indent % 4);
    else break;
    i++;
  }
  return { start, end, quotes, indent, text: content.slice(i, end), blank: i === end };
}

/** Every line of `content`, in order. */
function* lines(content: string): Generator<Line> {
  let pos = 0;
  while (pos <= content.length) {
    let nl = content.indexOf('\n', pos);
    if (nl === -1) nl = content.length;
    yield scanLine(content, pos, nl);
    pos = nl + 1;
  }
}

const FENCE_OPEN = /^(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^(`{3,}|~{3,})[ \t]*$/;
const LIST_ITEM = /^([-*+]|\d{1,9}[.)])( *)(\S?)/;
const THEMATIC_BREAK = /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const ATX_START = /^#{1,6}(?:[ \t]|$)/;
const SETEXT_UNDERLINE = /^(=+|-+)[ \t]*$/;

/** Content indent of the list item that `line` starts, or undefined when it is not a list item. */
function listItemIndent(line: Line): number | undefined {
  const m = LIST_ITEM.exec(line.text);
  if (!m || THEMATIC_BREAK.test(line.text)) return undefined;
  const spaces = m[2].length;
  if (spaces === 0 && m[3]) return undefined;
  return line.indent + m[1].length + (m[3] && spaces <= 4 ? spaces : 1);
}

/**
 * Regions of text that should not be scanned for links/tags: fenced code blocks (also inside lists and
 * blockquotes), indented code blocks and inline code. Follows CommonMark like the reading view does.
 * Returns sorted [start, end) ranges.
 */
export function codeRegions(content: string): Region[] {
  const regions: Region[] = [];
  // Content indent of each open list item; a line indented less than that leaves the item.
  const lists: Array<{ indent: number; quotes: number }> = [];
  let fence: { start: number; end: number; marker: string; quotes: number; indent: number } | null = null;
  let block: { start: number; end: number; quotes: number; indent: number } | null = null;
  // Whether an indented code block may start on the next line: it cannot interrupt a paragraph.
  let afterBlock = true;

  for (const line of lines(content)) {
    if (fence) {
      // A non-blank line that leaves the fence's blockquote or list item ends the fence with it.
      const outside = line.quotes < fence.quotes || (!line.blank && line.quotes === fence.quotes && line.indent < fence.indent);
      if (!outside) {
        const m = line.quotes === fence.quotes && line.indent - fence.indent <= 3 ? FENCE_CLOSE.exec(line.text) : null;
        if (m && m[1][0] === fence.marker[0] && m[1].length >= fence.marker.length) {
          regions.push([fence.start, line.end]);
          fence = null;
          afterBlock = true;
        } else fence.end = line.end;
        continue;
      }
      regions.push([fence.start, fence.end]);
      fence = null;
      afterBlock = true;
    }
    if (block) {
      const inside = line.blank ? line.quotes >= block.quotes : line.quotes === block.quotes && line.indent - block.indent >= 4;
      if (inside) {
        if (!line.blank) block.end = line.end;
        continue;
      }
      regions.push([block.start, block.end]);
      block = null;
    }
    if (line.blank) {
      afterBlock = true;
      continue;
    }

    while (lists.length && lists[lists.length - 1].quotes > line.quotes) lists.pop();
    const item = listItemIndent(line);
    // Lazy paragraph continuation lines stay in the item; anything that starts a block leaves it.
    if (afterBlock || item !== undefined || FENCE_OPEN.test(line.text) || ATX_START.test(line.text) || THEMATIC_BREAK.test(line.text)) {
      while (lists.length && lists[lists.length - 1].quotes === line.quotes && line.indent < lists[lists.length - 1].indent) lists.pop();
    }
    const top = lists[lists.length - 1];
    const indent = top && top.quotes === line.quotes ? top.indent : 0;
    const rel = line.indent - indent;

    if (rel <= 3) {
      const m = FENCE_OPEN.exec(line.text);
      // The info string of a backtick fence may not contain backticks: such a line is inline code instead.
      if (m && (m[1][0] === '~' || !m[2].includes('`'))) {
        fence = { start: line.start, end: line.end, marker: m[1], quotes: line.quotes, indent };
        continue;
      }
    } else if (afterBlock) {
      block = { start: line.start, end: line.end, quotes: line.quotes, indent };
      continue;
    }
    if (item !== undefined && rel <= 3) lists.push({ indent: item, quotes: line.quotes });
    afterBlock = rel <= 3 && (ATX_START.test(line.text) || THEMATIC_BREAK.test(line.text) || (!afterBlock && SETEXT_UNDERLINE.test(line.text)));
  }
  if (fence) regions.push([fence.start, fence.end]);
  if (block) regions.push([block.start, block.end]);

  // Inline code: never across a blank line (a paragraph break) or into a code block.
  const blocks = regions.slice();
  const inline = /(`+)[^`\n][\s\S]*?\1/g;
  let m: RegExpExecArray | null;
  while ((m = inline.exec(content))) {
    const start = m.index;
    const end = start + m[0].length;
    const inBlock = blocks.find(([s, e]) => start >= s && start < e);
    if (inBlock) {
      inline.lastIndex = inBlock[1];
      continue;
    }
    if (/\n[ \t]*\n/.test(m[0]) || blocks.some(([s]) => start < s && end > s)) {
      inline.lastIndex = start + m[1].length;
      continue;
    }
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
    if (inRegions(m.index, regions)) {
      // An opener inside code may have swallowed a real link after it (`` `[[` ... [[Real]] ``): rescan from there.
      WIKILINK.lastIndex = m.index + 1;
      continue;
    }
    // `\[[...]]` is escaped: the reading view shows the brackets as text.
    if (isEscaped(content, m.index + m[1].length)) continue;
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

/** True when the character at `index` is preceded by an odd number of backslashes. */
function isEscaped(content: string, index: number): boolean {
  let n = 0;
  while (index - n > 0 && content.charCodeAt(index - n - 1) === 92) n++;
  return n % 2 === 1;
}

/** Split the inside of `[[...]]` into target / heading / block / alias. Exported for autocomplete. */
export function parseLinkInner(inner: string): Omit<WikiLink, 'embed' | 'raw' | 'position'> | null {
  const pipe = inner.indexOf('|');
  const alias = pipe === -1 ? undefined : inner.slice(pipe + 1).trim();
  let target = pipe === -1 ? inner : inner.slice(0, pipe);
  // Inside tables the separator is written `\|`; the backslash is not part of the target.
  if (pipe !== -1 && target.endsWith('\\')) target = target.slice(0, -1);
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

/** Inline `#tags`. A tag must contain at least one non-digit character. Text inside `[[wikilinks]]` is never a tag. */
export function parseInlineTags(content: string, regions = codeRegions(content)): TagRef[] {
  const out: TagRef[] = [];
  const lineStarts = computeLineStarts(content);
  const skip = [...regions, ...parseWikiLinks(content, regions).map((l): Region => [l.position.start, l.position.end])].sort((a, b) => a[0] - b[0]);
  let m: RegExpExecArray | null;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(content))) {
    const start = m.index + m[1].length;
    if (inRegions(start, skip)) continue;
    let name = m[2].replace(/\/+$/, '');
    if (!name || /^\d+$/.test(name)) continue;
    // Ignore a trailing dash-only segment
    name = name.replace(/-+$/, '');
    if (!name) continue;
    out.push({ name, position: range(content, start, start + 1 + m[2].length, lineStarts) });
  }
  return out;
}

const ATX_HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

/**
 * ATX headings (`# Title`, also indented up to 3 spaces or inside blockquotes) and setext headings
 * (`Title` underlined with `===` or `---`), as the reading view renders them. Front matter is skipped
 * when no `regions` are given.
 */
export function parseHeadings(content: string, regions?: Region[]): HeadingRef[] {
  if (!regions) {
    regions = codeRegions(content);
    const fm = parseFrontmatter(content);
    if (fm.bodyStart > 0) regions.unshift([0, fm.bodyStart]);
  }
  const out: HeadingRef[] = [];
  const lineStarts = computeLineStarts(content);
  // Lines of the paragraph a setext underline would turn into a heading.
  let para: Line[] = [];
  for (const line of lines(content)) {
    if (line.blank || inRegions(line.start, regions)) {
      para = [];
      continue;
    }
    if (line.indent > 3) {
      if (para.length) para.push(line);
      continue;
    }
    const atx = ATX_HEADING.exec(line.text);
    if (atx) {
      out.push({ level: atx[1].length, text: atx[2].trim(), position: range(content, line.start, line.end, lineStarts) });
      para = [];
      continue;
    }
    const underline = SETEXT_UNDERLINE.exec(line.text);
    if (underline && para.length && para[0].quotes === line.quotes) {
      const text = para.map((l) => l.text).join('\n').trim();
      out.push({ level: underline[1][0] === '=' ? 1 : 2, text, position: range(content, para[0].start, line.end, lineStarts) });
      para = [];
      continue;
    }
    if (THEMATIC_BREAK.test(line.text) || listItemIndent(line) !== undefined) {
      para = [];
      continue;
    }
    // A deeper blockquote starts a new paragraph; a shallower line is a lazy continuation of the current one.
    if (para.length && line.quotes > para[0].quotes) para = [line];
    else para.push(line);
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
