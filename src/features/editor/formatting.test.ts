import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { insertWikilinkSpec, toggleChecklistSpec, toggleWrapSpec } from './formatting';

function apply(doc: string, selection: { anchor: number; head?: number }, spec: (state: EditorState) => TransactionSpec) {
  const state = EditorState.create({ doc, selection: EditorSelection.single(selection.anchor, selection.head ?? selection.anchor) });
  const next = state.update(spec(state)).state;
  const main = next.selection.main;
  return { doc: next.doc.toString(), from: main.from, to: main.to };
}

describe('toggleWrapSpec', () => {
  it('wraps a selection and keeps it selected', () => {
    expect(apply('hello world', { anchor: 0, head: 5 }, (s) => toggleWrapSpec(s, '**'))).toEqual({ doc: '**hello** world', from: 2, to: 7 });
  });

  it('unwraps when the selection is already wrapped', () => {
    expect(apply('**hello** world', { anchor: 2, head: 7 }, (s) => toggleWrapSpec(s, '**'))).toEqual({ doc: 'hello world', from: 0, to: 5 });
    expect(apply('**hello** world', { anchor: 0, head: 9 }, (s) => toggleWrapSpec(s, '**'))).toEqual({ doc: 'hello world', from: 0, to: 5 });
  });

  it('wraps the word under an empty cursor', () => {
    expect(apply('hello world', { anchor: 8 }, (s) => toggleWrapSpec(s, '*'))).toEqual({ doc: 'hello *world*', from: 7, to: 12 });
    expect(apply('hello *world*', { anchor: 9 }, (s) => toggleWrapSpec(s, '*'))).toEqual({ doc: 'hello world', from: 6, to: 11 });
  });

  it('inserts an empty marker pair when there is nothing to wrap', () => {
    expect(apply('a ', { anchor: 2 }, (s) => toggleWrapSpec(s, '=='))).toEqual({ doc: 'a ====', from: 4, to: 4 });
  });

  it("nests italics and bold instead of eating each other's markers", () => {
    const italic = (s: EditorState) => toggleWrapSpec(s, '*');
    const bold = (s: EditorState) => toggleWrapSpec(s, '**');
    expect(apply('**hello** x', { anchor: 5 }, italic)).toEqual({ doc: '***hello*** x', from: 3, to: 8 });
    expect(apply('**hello** x', { anchor: 2, head: 7 }, italic)).toEqual({ doc: '***hello*** x', from: 3, to: 8 });
    expect(apply('**hello** x', { anchor: 0, head: 9 }, italic)).toEqual({ doc: '***hello*** x', from: 3, to: 8 });
    expect(apply('***hello*** x', { anchor: 6 }, italic)).toEqual({ doc: '**hello** x', from: 2, to: 7 });
    expect(apply('***hello*** x', { anchor: 6 }, bold)).toEqual({ doc: '*hello* x', from: 1, to: 6 });
    expect(apply('*hello* x', { anchor: 3 }, bold)).toEqual({ doc: '***hello*** x', from: 3, to: 8 });
  });
});

describe('toggleChecklistSpec', () => {
  it('cycles plain text, list items and tasks', () => {
    expect(apply('todo', { anchor: 1 }, toggleChecklistSpec).doc).toBe('- [ ] todo');
    expect(apply('- item', { anchor: 1 }, toggleChecklistSpec).doc).toBe('- [ ] item');
    expect(apply('- [ ] item', { anchor: 1 }, toggleChecklistSpec).doc).toBe('- [x] item');
    expect(apply('- [x] item', { anchor: 1 }, toggleChecklistSpec).doc).toBe('- [ ] item');
    expect(apply('  1. nested', { anchor: 1 }, toggleChecklistSpec).doc).toBe('  1. [ ] nested');
  });

  it('applies to every selected line once', () => {
    expect(apply('a\n- [ ] b\nc', { anchor: 0, head: 11 }, toggleChecklistSpec).doc).toBe('- [ ] a\n- [x] b\n- [ ] c');
  });
});

describe('insertWikilinkSpec', () => {
  it('inserts empty brackets with the cursor inside', () => {
    expect(apply('see ', { anchor: 4 }, insertWikilinkSpec)).toEqual({ doc: 'see [[]]', from: 6, to: 6 });
  });

  it('wraps the selection', () => {
    expect(apply('see Welcome', { anchor: 4, head: 11 }, insertWikilinkSpec)).toEqual({ doc: 'see [[Welcome]]', from: 13, to: 13 });
  });
});
