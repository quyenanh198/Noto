import { parseLinkInner } from '../../core/markdown/links';
import type { HeadingRef } from '../../core/types';

export interface OutlineNode {
  level: number;
  /** Heading text as written (used for navigation). */
  text: string;
  /** Heading text with inline markdown markup removed (used for display). */
  display: string;
  /** 0-based line of the heading. */
  line: number;
  /** Identity of the heading within its note (level, text, occurrence index); stable while lines shift. */
  key: string;
  children: OutlineNode[];
}

/** Remove inline markdown markup from heading text: links, emphasis, code, strikethrough, highlight, html tags. */
export function stripMarkup(text: string): string {
  return text
    .replace(/!?\[\[([^\]]*)\]\]/g, (_, inner: string) => parseLinkInner(inner)?.display ?? inner)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\b_(.+?)_\b/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/==(.+?)==/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/** Nest headings under the nearest preceding shallower heading, tolerating skipped levels. */
export function buildOutlineTree(headings: HeadingRef[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  const seen = new Map<string, number>();
  for (const h of headings) {
    const id = `${h.level}:${h.text}`;
    const nth = seen.get(id) ?? 0;
    seen.set(id, nth + 1);
    const node: OutlineNode = { level: h.level, text: h.text, display: stripMarkup(h.text), line: h.position.line, key: `${id}:${nth}`, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].level >= h.level) stack.pop();
    const parent = stack[stack.length - 1];
    (parent ? parent.children : roots).push(node);
    stack.push(node);
  }
  return roots;
}
