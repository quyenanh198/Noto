import { startCompletion } from '@codemirror/autocomplete';
import { type ChangeSpec, EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

const TASK_LINE = /^(\s*)(?:[-*+]|\d+[.)])\s+\[( |x|X)\]\s/;
const LIST_LINE = /^(\s*)(?:[-*+]|\d+[.)])\s+/;

/**
 * Wrap each selection (or the word under an empty cursor) in `marker`, or unwrap it when it is already wrapped.
 * With nothing to wrap, inserts a marker pair and places the cursor between them.
 */
export function toggleWrapSpec(state: EditorState, marker: string): TransactionSpec {
  const n = marker.length;
  return state.changeByRange((range) => {
    let { from, to } = range;
    if (from === to) {
      const word = state.wordAt(from);
      if (word) ({ from, to } = word);
    }
    const inner = state.sliceDoc(from, to);
    if (to - from >= 2 * n && inner.startsWith(marker) && inner.endsWith(marker)) {
      return {
        changes: [
          { from, to: from + n },
          { from: to - n, to },
        ],
        range: EditorSelection.range(from, to - 2 * n),
      };
    }
    if (from >= n && state.sliceDoc(from - n, from) === marker && state.sliceDoc(to, to + n) === marker) {
      return {
        changes: [
          { from: from - n, to: from },
          { from: to, to: to + n },
        ],
        range: EditorSelection.range(from - n, to - n),
      };
    }
    return {
      changes: [
        { from, insert: marker },
        { from: to, insert: marker },
      ],
      range: EditorSelection.range(from + n, to + n),
    };
  });
}

/**
 * Cycle the checklist state of every selected line: plain text gets a `- [ ] ` prefix,
 * a list item gets `[ ] `, and an existing task flips between `[ ]` and `[x]`.
 */
export function toggleChecklistSpec(state: EditorState): TransactionSpec {
  const changes: ChangeSpec[] = [];
  const seen = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      const task = TASK_LINE.exec(line.text);
      if (task) {
        const box = line.from + task[0].lastIndexOf('[') + 1;
        changes.push({ from: box, to: box + 1, insert: task[2] === ' ' ? 'x' : ' ' });
        continue;
      }
      const list = LIST_LINE.exec(line.text);
      if (list) {
        changes.push({ from: line.from + list[0].length, insert: '[ ] ' });
        continue;
      }
      const indent = /^\s*/.exec(line.text)?.[0].length ?? 0;
      changes.push({ from: line.from + indent, insert: '- [ ] ' });
    }
  }
  return { changes };
}

/** Wrap each selection in `[[...]]` and put the cursor before the closing brackets. */
export function insertWikilinkSpec(state: EditorState): TransactionSpec {
  return state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    return {
      changes: { from: range.from, to: range.to, insert: `[[${text}]]` },
      range: EditorSelection.cursor(range.from + 2 + text.length),
    };
  });
}

function wrapCommand(marker: string): (view: EditorView) => boolean {
  return (view) => {
    view.dispatch(toggleWrapSpec(view.state, marker));
    return true;
  };
}

export const toggleBold = wrapCommand('**');
export const toggleItalic = wrapCommand('*');
export const toggleStrikethrough = wrapCommand('~~');
export const toggleHighlight = wrapCommand('==');

export function toggleChecklist(view: EditorView): boolean {
  view.dispatch(toggleChecklistSpec(view.state));
  return true;
}

export function insertWikilink(view: EditorView): boolean {
  view.dispatch(insertWikilinkSpec(view.state));
  startCompletion(view);
  return true;
}
