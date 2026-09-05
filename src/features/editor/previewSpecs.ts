import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { parseInlineTags, parseWikiLinks } from '../../core/markdown/links';
import type { TagRef, WikiLink } from '../../core/types';

type Tree = ReturnType<typeof syntaxTree>;

/**
 * What the live-preview plugin should draw for a region of the document.
 * `hide`, `task` and `hr` are only applied on lines that do not contain the selection.
 */
export type PreviewSpec =
  | { kind: 'hide'; from: number; to: number }
  | { kind: 'mark'; from: number; to: number; cls: string }
  | { kind: 'wikilink'; from: number; to: number; target: string }
  | { kind: 'tag'; from: number; to: number; name: string }
  | { kind: 'task'; from: number; to: number; checked: boolean }
  | { kind: 'hr'; from: number; to: number }
  | { kind: 'line'; from: number; cls: string };

const CODE_NODES = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'HTMLBlock', 'CommentBlock', 'Frontmatter']);
const HIGHLIGHT = /==([^=\s](?:[^=\n]*?[^=\s])?)==/g;

/** True when `pos` is inside a code span, code block or front matter (no links/tags there). */
export function inCode(tree: Tree, pos: number): boolean {
  let node: ReturnType<Tree['resolveInner']> | null = tree.resolveInner(pos, 1);
  while (node) {
    if (CODE_NODES.has(node.name)) return true;
    node = node.parent;
  }
  return false;
}

/** Line numbers (1-based) touched by any selection range. Markup on these lines stays visible. */
export function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

/** Whether a spec starting at `pos` sits on a line the user is editing (markup must stay visible). */
export function isRevealed(state: EditorState, active: ReadonlySet<number>, pos: number): boolean {
  return active.has(state.doc.lineAt(pos).number);
}

/** Collect preview specs for the document range [from, to]. `tree` defaults to the current syntax tree. */
export function collectPreviewSpecs(state: EditorState, from: number, to: number, tree: Tree = syntaxTree(state)): PreviewSpec[] {
  const specs: PreviewSpec[] = [];
  collectTreeSpecs(state, tree, from, to, specs);
  collectInlineSpecs(state, tree, from, to, specs);
  return specs;
}

function collectTreeSpecs(state: EditorState, tree: Tree, from: number, to: number, out: PreviewSpec[]): void {
  const doc = state.doc;
  const lineSpecs = (nodeFrom: number, nodeTo: number, cls: string, firstCls?: string, lastCls?: string) => {
    const first = doc.lineAt(nodeFrom).number;
    const last = doc.lineAt(nodeTo).number;
    const start = doc.lineAt(Math.max(nodeFrom, from)).number;
    const end = doc.lineAt(Math.min(nodeTo, to)).number;
    for (let n = start; n <= end; n++) {
      const line = doc.line(n);
      let classes = cls;
      if (firstCls && n === first) classes += ` ${firstCls}`;
      if (lastCls && n === last) classes += ` ${lastCls}`;
      out.push({ kind: 'line', from: line.from, cls: classes });
    }
  };

  tree.iterate({
    from,
    to,
    enter(node) {
      const name = node.name;
      if (name.startsWith('ATXHeading')) {
        const mark = node.node.getChild('HeaderMark');
        if (mark) {
          const next = doc.sliceString(mark.to, mark.to + 1);
          out.push({ kind: 'hide', from: mark.from, to: next === ' ' || next === '\t' ? mark.to + 1 : mark.to });
        }
        out.push({ kind: 'line', from: doc.lineAt(node.from).from, cls: `cm-heading-line cm-heading-${name.slice(-1)}` });
        return;
      }
      switch (name) {
        case 'EmphasisMark':
        case 'StrikethroughMark':
          out.push({ kind: 'hide', from: node.from, to: node.to });
          return;
        case 'InlineCode':
          for (const mark of node.node.getChildren('CodeMark')) out.push({ kind: 'hide', from: mark.from, to: mark.to });
          return;
        case 'FencedCode':
        case 'CodeBlock':
          lineSpecs(node.from, node.to, 'cm-codeblock-line', 'cm-codeblock-start', 'cm-codeblock-end');
          return;
        case 'Blockquote':
          lineSpecs(node.from, node.to, 'cm-quote-line');
          return;
        case 'Frontmatter':
          lineSpecs(node.from, node.to, 'cm-frontmatter-line');
          return;
        case 'Task': {
          const marker = node.node.getChild('TaskMarker');
          if (!marker) return;
          const checked = /x/i.test(doc.sliceString(marker.from, marker.to));
          out.push({ kind: 'task', from: marker.from, to: marker.to, checked });
          if (checked && marker.to < node.to) out.push({ kind: 'mark', from: marker.to, to: node.to, cls: 'cm-task-done' });
          return;
        }
        case 'HorizontalRule':
          out.push({ kind: 'hr', from: node.from, to: node.to });
          return;
      }
    },
  });
}

function collectInlineSpecs(state: EditorState, tree: Tree, from: number, to: number, out: PreviewSpec[]): void {
  const text = state.doc.sliceString(from, to);

  for (const link of parseWikiLinks(text, [])) {
    const rawStart = from + link.position.start;
    const start = rawStart + (link.embed ? 1 : 0);
    const end = from + link.position.end;
    if (inCode(tree, start)) continue;
    out.push({ kind: 'wikilink', from: start, to: end, target: link.target });
    const pipe = link.raw.indexOf('|');
    out.push({ kind: 'hide', from: start, to: pipe === -1 ? start + 2 : rawStart + pipe + 1 });
    out.push({ kind: 'hide', from: end - 2, to: end });
  }

  for (const tag of parseInlineTags(text, [])) {
    const start = from + tag.position.start;
    if (inCode(tree, start)) continue;
    out.push({ kind: 'tag', from: start, to: from + tag.position.end, name: tag.name });
  }

  HIGHLIGHT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HIGHLIGHT.exec(text))) {
    const start = from + m.index;
    const end = start + m[0].length;
    if (inCode(tree, start)) continue;
    out.push({ kind: 'mark', from: start + 2, to: end - 2, cls: 'cm-highlight' });
    out.push({ kind: 'hide', from: start, to: start + 2 });
    out.push({ kind: 'hide', from: end - 2, to: end });
  }
}

/** The wikilink whose source text covers `pos`, if any. */
export function wikilinkAt(state: EditorState, pos: number): WikiLink | undefined {
  const line = state.doc.lineAt(pos);
  return parseWikiLinks(line.text, []).find((l) => pos >= line.from + l.position.start && pos <= line.from + l.position.end);
}

/** The tag whose source text covers `pos`, if any. */
export function tagAt(state: EditorState, pos: number): TagRef | undefined {
  const line = state.doc.lineAt(pos);
  return parseInlineTags(line.text, []).find((t) => pos >= line.from + t.position.start && pos <= line.from + t.position.end);
}
