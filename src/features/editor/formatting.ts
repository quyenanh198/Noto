import { startCompletion } from '@codemirror/autocomplete';
import { type ChangeSpec, EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

const TASK_LINE = /^(\s*)(?:[-*+]|\d+[.)])\s+\[( |x|X)\]\s/;
const LIST_LINE = /^(\s*)(?:[-*+]|\d+[.)])\s+/;

/** Number of consecutive `ch` characters ending right before `pos`, looking back no further than `limit`. */
function runBefore(state: EditorState, pos: number, ch: string, limit = 0): number {
  let i = pos;
  while (i > limit && state.sliceDoc(i - 1, i) === ch) i--;
  return pos - i;
}

/** Number of consecutive `ch` characters starting at `pos`, looking ahead no further than `limit`. */
function runAfter(state: EditorState, pos: number, ch: string, limit = state.doc.length): number {
  let i = pos;
  while (i < limit && state.sliceDoc(i, i + 1) === ch) i++;
  return i - pos;
}

/**
 * Wrap each selection (or the word under an empty cursor) in `marker`, or unwrap it when it is already wrapped.
 * `marker` is a run of one character (`*`, `**`, `~~`, `==`). The runs of that character around the text decide
 * whether it is wrapped, so bold and italics nest like in Obsidian: `**bold**` + `*` -> `***bold***`, and
 * `***both***` + `*` -> `**bold**`. With nothing to wrap, inserts a marker pair and places the cursor between them.
 */
export function toggleWrapSpec(state: EditorState, marker: string): TransactionSpec {
  const n = marker.length;
  const ch = marker[0];
  return state.changeByRange((range) => {
    let { from, to } = range;
    if (from === to) {
      const word = state.wordAt(from);
      if (word) ({ from, to } = word);
    }
    // Marker characters at the edges of the selection count as surrounding markers, so selecting `**bold**`
    // behaves like selecting `bold`.
    const innerFrom = from + runAfter(state, from, ch, to);
    const innerTo = to - runBefore(state, to, ch, innerFrom);
    const run = Math.min(runBefore(state, innerFrom, ch), runAfter(state, innerTo, ch));
    // A single `*` toggles italics: one or three stars mean italic, two mean bold only.
    const wrapped = n === 1 ? run % 2 === 1 : run >= n;
    if (wrapped) {
      return {
        changes: [
          { from: innerFrom - n, to: innerFrom },
          { from: innerTo, to: innerTo + n },
        ],
        range: EditorSelection.range(innerFrom - n, innerTo - n),
      };
    }
    return {
      changes: [
        { from: innerFrom, insert: marker },
        { from: innerTo, insert: marker },
      ],
      range: EditorSelection.range(innerFrom + n, innerTo + n),
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
