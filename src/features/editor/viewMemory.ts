import type { Compartment, EditorState } from '@codemirror/state';
import { isWithin } from '../../core/vault/path';
import { useWorkspace } from '../../state/store';

/*
 * What a note's view leaves behind when it unmounts, so that switching tabs or toggling reading view
 * does not reset the editor (undo history, selection) or the scroll position, like in Obsidian.
 * Entries live as long as the note's tab is open.
 */

export interface EditorMemory {
  /** Full editor state: document, selection and undo history. */
  state: EditorState;
  /** The compartment holding the handlers bound to the mount that produced `state`. */
  dynamic: Compartment;
}

export interface LineMemory {
  /** 0-based source line at the top of the viewport. */
  line: number;
  /** Which view recorded it; the editor keeps its own selection when the line came from itself. */
  from: 'editor' | 'reading';
}

const editors = new Map<string, EditorMemory>();
const lines = new Map<string, LineMemory>();

export function rememberEditor(path: string, memory: EditorMemory): void {
  editors.set(path, memory);
}

/** Hand back (and forget) the editor state kept for a note. */
export function takeEditor(path: string): EditorMemory | undefined {
  const memory = editors.get(path);
  editors.delete(path);
  return memory;
}

export function rememberLine(path: string, line: number, from: LineMemory['from']): void {
  lines.set(path, { line, from });
}

/** Hand back (and forget) the top line kept for a note. */
export function takeLine(path: string): LineMemory | undefined {
  const memory = lines.get(path);
  lines.delete(path);
  return memory;
}

function rekey<T>(map: Map<string, T>, oldPath: string, newPath: string): void {
  for (const [path, memory] of [...map]) {
    if (!isWithin(path, oldPath)) continue;
    map.delete(path);
    map.set(newPath + path.slice(oldPath.length), memory);
  }
}

/**
 * Move what the views of a renamed note (or of every note inside a renamed folder) kept to the new path.
 * Must run before the tabs follow the rename, which is when entries of unknown paths are dropped.
 */
export function viewMemoryRenamed(oldPath: string, newPath: string): void {
  rekey(editors, oldPath, newPath);
  rekey(lines, oldPath, newPath);
}

// Closing a tab (or the whole vault) forgets what its views kept.
useWorkspace.subscribe((state, prev) => {
  if (state.openTabs === prev.openTabs) return;
  for (const path of [...editors.keys()]) if (!state.openTabs.includes(path)) editors.delete(path);
  for (const path of [...lines.keys()]) if (!state.openTabs.includes(path)) lines.delete(path);
});
