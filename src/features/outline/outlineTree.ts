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
  for (const h of headings) {
    const node: OutlineNode = { level: h.level, text: h.text, display: stripMarkup(h.text), line: h.position.line, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].level >= h.level) stack.pop();
    const parent = stack[stack.length - 1];
    (parent ? parent.children : roots).push(node);
    stack.push(node);
  }
  return roots;
}
