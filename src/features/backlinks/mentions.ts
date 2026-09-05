import { codeRegions, parseFrontmatter, parseWikiLinks } from '../../core/markdown/links';
import type { WikiLink } from '../../core/types';

export interface UnlinkedMention {
  path: string;
  /** 0-based line of the occurrence. */
  line: number;
  /** Offsets into the file content. */
  start: number;
  end: number;
  /** The matched text as written (original casing). */
  text: string;
}

export interface Snippet {
  /** 0-based line in the source file. */
  line: number;
  /** The line's text with leading whitespace removed. */
  text: string;
  /** Ranges to highlight, relative to `text`. */
  ranges: Array<[number, number]>;
}

type Region = [number, number];

/** The full line (without its newline) that contains `index`, with its offset in `content`. */
export function lineContaining(content: string, index: number): { start: number; end: number; text: string } {
  const start = content.lastIndexOf('\n', index - 1) + 1;
  const nl = content.indexOf('\n', index);
  const end = nl === -1 ? content.length : nl;
  return { start, end, text: content.slice(start, end) };
}

/** One snippet per source line, highlighting every link on that line. */
export function linkSnippets(content: string, links: WikiLink[]): Snippet[] {
  const byLine = new Map<number, { snippet: Snippet; offset: number }>();
  for (const link of links) {
    const { start, end, line } = link.position;
    let entry = byLine.get(line);
    if (!entry) {
      const full = lineContaining(content, start);
      const indent = full.text.length - full.text.trimStart().length;
      entry = { snippet: { line, text: full.text.slice(indent), ranges: [] }, offset: full.start + indent };
      byLine.set(line, entry);
    }
    entry.snippet.ranges.push([start - entry.offset, end - entry.offset]);
  }
  return [...byLine.values()].map((e) => e.snippet).sort((a, b) => a.line - b.line);
}

/** The wikilink that replaces a mention: `[[Link]]`, or `[[Link|as written]]` when the text differs. */
export function wikilinkFor(linkText: string, text: string): string {
  return text === linkText ? `[[${linkText}]]` : `[[${linkText}|${text}]]`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inRegion(index: number, regions: Region[]): boolean {
  for (const [s, e] of regions) {
    if (index < s) return false;
    if (index < e) return true;
  }
  return false;
}

/** Regions that must not be scanned: front matter, code, and existing wikilinks. */
function skipRegions(content: string): Region[] {
  const regions: Region[] = codeRegions(content);
  const fm = parseFrontmatter(content);
  if (fm.bodyStart > 0) regions.push([0, fm.bodyStart]);
  for (const link of parseWikiLinks(content, regions)) regions.push([link.position.start, link.position.end]);
  return regions.sort((a, b) => a[0] - b[0]);
}

/**
 * Case-insensitive whole-word occurrences of `title` (or any of `aliases`) in `files`,
 * skipping files in `exclude` and text inside wikilinks, code, or front matter.
 */
export function findUnlinkedMentions(
  title: string,
  files: Array<{ path: string; content: string }>,
  exclude: Set<string>,
  aliases: string[] = [],
): UnlinkedMention[] {
  const names = [...new Set([title, ...aliases].map((n) => n.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (names.length === 0) return [];
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${names.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  const out: UnlinkedMention[] = [];
  for (const file of files) {
    if (exclude.has(file.path)) continue;
    const regions = skipRegions(file.content);
    let line = 0;
    let scanned = 0;
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(file.content))) {
      const start = m.index;
      for (; scanned < start; scanned++) if (file.content.charCodeAt(scanned) === 10) line++;
      if (inRegion(start, regions)) continue;
      out.push({ path: file.path, line, start, end: start + m[0].length, text: m[0] });
    }
  }
  return out;
}
